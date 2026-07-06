// set-user-active — the app's only service-role code path.
//
// Deactivates or reactivates a user in two steps:
//   1. Flips profiles.is_active AS THE CALLER (their JWT is forwarded to
//      PostgREST): RLS and the role-protect trigger prove the caller is an
//      active owner and enforce the last-active-owner guard. This function
//      contains no hand-rolled permission checks — the database decides.
//   2. Bans/unbans the Supabase Auth account with the service role, so a
//      deactivated user cannot log in or refresh a token at all. The service
//      role touches ONLY the Auth admin API, never application tables, and
//      never leaves this function's environment.
//
// An already-issued access token stays valid for up to an hour after a ban;
// the is_active gate in the RLS policies (migration 0011) covers that window.
//
// Deploy: supabase functions deploy set-user-active
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically; JWT verification is on by default.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const BAN_FOREVER = '876000h'; // ~100 years; 'none' lifts the ban

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only.' });

  let user_id: unknown;
  let active: unknown;
  try {
    ({ user_id, active } = await req.json());
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (typeof user_id !== 'string' || typeof active !== 'boolean') {
    return json(400, { error: 'Expected { user_id: string, active: boolean }.' });
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Missing authorization.' });

  // Step 1 — as the caller. If the caller is not an active owner, RLS filters
  // the row (0 rows) or the trigger raises; either way nothing changes.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: updated, error: updateError } = await asCaller
    .from('profiles')
    .update({ is_active: active })
    .eq('id', user_id)
    .select('id')
    .maybeSingle();
  if (updateError) return json(403, { error: updateError.message });
  if (!updated) return json(403, { error: 'Not permitted.' });

  // Step 2 — Auth-level ban/unban with the service role.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error: banError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: active ? 'none' : BAN_FOREVER,
  });
  if (banError) {
    // Roll the flag back so is_active and the Auth ban never drift apart.
    await asCaller.from('profiles').update({ is_active: !active }).eq('id', user_id);
    return json(500, { error: `Auth update failed: ${banError.message}` });
  }

  return json(200, { ok: true });
});

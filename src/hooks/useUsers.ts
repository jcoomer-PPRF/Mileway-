import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/db';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

/** Map of user id → display name, for resolving created_by/changed_by. */
export function useUserMap() {
  const { data } = useUsers();
  const map = new Map<string, string>();
  for (const u of data ?? []) map.set(u.id, u.full_name || u.email);
  return map;
}

export function useUserMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const update = useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: Partial<Pick<Profile, 'role' | 'default_entity_id' | 'full_name' | 'job_title_id'>>;
    }) => {
      const { error } = await supabase.from('profiles').update(input).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  // Activation goes through the set-user-active Edge Function, which flips
  // is_active as the calling owner AND bans/unbans the Supabase Auth account,
  // so a deactivated user cannot log in at all — not just read nothing.
  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase.functions.invoke('set-user-active', {
        body: { user_id: id, active },
      });
      if (error) {
        let message = error.message;
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the default message
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: invalidate,
  });
  return { update, setActive };
}

export const ALL_ROLES: UserRole[] = ['owner', 'manager', 'contributor', 'accountant', 'auditor'];

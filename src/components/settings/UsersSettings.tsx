import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ALL_ROLES, useUsers, useUserMutations } from '@/hooks/useUsers';
import { useEntities } from '@/hooks/useReference';
import { useJobTitles } from '@/hooks/useLookups';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { PageLoader, Spinner } from '@/components/ui/spinner';
import type { Profile, UserRole } from '@/types/db';

export function UsersSettings() {
  const { profile: me } = useAuth();
  const { data: users, isLoading } = useUsers();
  const { data: entities } = useEntities();
  const { data: jobTitles } = useJobTitles();
  const { update, setActive } = useUserMutations();
  const [editing, setEditing] = useState<Profile | null>(null);

  const entityName = (id: string | null) => (id ? entities?.find((e) => e.id === id)?.name ?? '—' : '—');
  const jobTitleName = (id: string | null) => (id ? jobTitles?.find((j) => j.id === id)?.name ?? '—' : '—');

  if (isLoading) return <PageLoader />;

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Email</th>
            <th className="px-4 py-2">Role</th>
            <th className="px-4 py-2">Job title</th>
            <th className="px-4 py-2">Default entity</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u) => (
            <tr key={u.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-800">{u.full_name || '—'}</td>
              <td className="px-4 py-2 text-slate-600">{u.email}</td>
              <td className="px-4 py-2">{ROLE_LABELS[u.role]}</td>
              <td className="px-4 py-2 text-slate-600">{jobTitleName(u.job_title_id)}</td>
              <td className="px-4 py-2 text-slate-600">{entityName(u.default_entity_id)}</td>
              <td className="px-4 py-2">
                {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
              </td>
              <td className="px-4 py-2 text-right">
                <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="px-4 py-3 text-xs text-slate-400">
        New accounts default to Contributor. Deactivating an account blocks sign-in and all data
        access until an owner reactivates it.
      </p>

      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSave={async ({ is_active, ...fields }) => {
            await update.mutateAsync({ id: editing.id, input: fields });
            if (is_active !== undefined && is_active !== editing.is_active) {
              await setActive.mutateAsync({ id: editing.id, active: is_active });
            }
          }}
        />
      )}
    </Card>
  );
}

function EditUserModal({
  user,
  isSelf,
  onClose,
  onSave,
}: {
  user: Profile;
  isSelf: boolean;
  onClose: () => void;
  onSave: (
    input: Partial<Pick<Profile, 'role' | 'is_active' | 'default_entity_id' | 'job_title_id'>>,
  ) => Promise<void>;
}) {
  const { data: entities } = useEntities();
  const { data: jobTitles } = useJobTitles();
  const [role, setRole] = useState<UserRole>(user.role);
  const [active, setActive] = useState(user.is_active);
  const [defaultEntity, setDefaultEntity] = useState(user.default_entity_id ?? '');
  const [jobTitle, setJobTitle] = useState(user.job_title_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isSelf && role !== 'owner') {
      if (!window.confirm('You are changing your own role away from Owner. You may lose owner access. Continue?'))
        return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSave({
        role,
        is_active: active,
        default_entity_id: defaultEntity || null,
        job_title_id: jobTitle || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${user.full_name || user.email}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Role" required hint={ROLE_DESCRIPTIONS[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job title" hint="Display only — does not affect permissions.">
          <Select value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}>
            <option value="">None</option>
            {(jobTitles ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default entity">
          <Select value={defaultEntity} onChange={(e) => setDefaultEntity(e.target.value)}>
            <option value="">None</option>
            {(entities ?? []).map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Spinner className="text-white" />}
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

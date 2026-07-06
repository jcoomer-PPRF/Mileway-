import { useState, type FormEvent } from 'react';
import { Paperclip } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEntities } from '@/hooks/useReference';
import { useVehicles } from '@/hooks/useVehicles';
import { useUsers } from '@/hooks/useUsers';
import { useDocumentTypes } from '@/hooks/useLookups';
import { getDocumentUrl, uploadDocumentFile, type DocumentInput } from '@/hooks/useDocuments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { ModalFooter } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';

const strOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

type Scope = 'org' | 'vehicle' | 'driver';

function initialScope(d?: Partial<DocumentInput>): Scope {
  if (d?.profile_id) return 'driver';
  if (d?.vehicle_id) return 'vehicle';
  return 'org';
}

export function DocumentForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<DocumentInput>;
  onSubmit: (values: DocumentInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { profile } = useAuth();
  const { data: entities } = useEntities();
  const { data: vehicles } = useVehicles();
  const { data: users } = useUsers();
  const { data: types } = useDocumentTypes();

  const [scope, setScope] = useState<Scope>(initialScope(initial));
  const [title, setTitle] = useState(initial?.title ?? '');
  const [typeId, setTypeId] = useState(initial?.document_type_id ?? '');
  const [entityId, setEntityId] = useState(initial?.entity_id ?? profile?.default_entity_id ?? '');
  const [vehicleId, setVehicleId] = useState(initial?.vehicle_id ?? '');
  const [profileId, setProfileId] = useState(initial?.profile_id ?? '');
  const [issued, setIssued] = useState(initial?.issued_date ?? '');
  const [expiration, setExpiration] = useState(initial?.expiration_date ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [receiptPath, setReceiptPath] = useState<string | null>(initial?.file_path ?? null);
  const [file, setFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function viewFile() {
    if (!receiptPath) return;
    const url = await getDocumentUrl(receiptPath);
    if (url) window.open(url, '_blank');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Required';
    if (!typeId) errs.document_type_id = 'Select a type';
    if (!entityId) errs.entity_id = 'Select an entity';
    if (scope === 'vehicle' && !vehicleId) errs.vehicle_id = 'Select a vehicle';
    if (scope === 'driver' && !profileId) errs.profile_id = 'Select a person';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      let path = receiptPath;
      if (file) path = await uploadDocumentFile(file, entityId, scope === 'driver' ? profileId : null);

      await onSubmit({
        entity_id: entityId,
        vehicle_id: scope === 'vehicle' ? vehicleId : null,
        profile_id: scope === 'driver' ? profileId : null,
        document_type_id: typeId,
        title: title.trim(),
        file_path: path,
        issued_date: strOrNull(issued),
        expiration_date: strOrNull(expiration),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes: strOrNull(notes),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Attached to">
        <div className="flex flex-wrap gap-2">
          {(['org', 'vehicle', 'driver'] as Scope[]).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={scope === s ? 'primary' : 'secondary'}
              onClick={() => setScope(s)}
            >
              {s === 'org' ? 'Organization' : s === 'vehicle' ? 'Vehicle' : 'Driver / person'}
            </Button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required error={errors.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Document type" required error={errors.document_type_id}>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Select…</option>
            {(types ?? []).filter((t) => t.is_active || t.id === typeId).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Entity" required error={errors.entity_id}>
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Select…</option>
            {(entities ?? []).map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </Select>
        </Field>

        {scope === 'vehicle' && (
          <Field label="Vehicle" required error={errors.vehicle_id}>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Select…</option>
              {(vehicles ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.year, v.make, v.model].filter(Boolean).join(' ')} {v.license_plate ? `· ${v.license_plate}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {scope === 'driver' && (
          <Field label="Person" required error={errors.profile_id}>
            <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">Select…</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issued date">
          <Input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </Field>
        <Field
          label="Expiration date"
          hint="Leave blank for vehicle insurance/registration PDFs — those expirations live on the vehicle."
        >
          <Input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} />
        </Field>
      </div>

      <Field label="Tags" hint="Comma-separated.">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. 2026, signed" />
      </Field>

      <Field label="File" hint="Stored as a file only (no OCR). PDF or image.">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Paperclip className="h-4 w-4" />
            {file ? 'Change file' : 'Choose file'}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && <span className="text-sm text-slate-600">{file.name}</span>}
          {!file && receiptPath && (
            <Button type="button" variant="ghost" size="sm" onClick={viewFile}>
              View current file
            </Button>
          )}
        </div>
      </Field>

      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner className="text-white" />}
          Save document
        </Button>
      </ModalFooter>
    </form>
  );
}

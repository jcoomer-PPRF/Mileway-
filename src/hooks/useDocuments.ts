import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DocumentExpiring, DocumentRow, DriverCredential } from '@/types/db';

export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
    },
  });
}

export interface DocumentInput {
  entity_id: string;
  vehicle_id: string | null;
  profile_id: string | null;
  document_type_id: string;
  title: string;
  file_path: string | null;
  issued_date: string | null;
  expiration_date: string | null;
  tags: string[];
  notes: string | null;
}

/**
 * Uploads a file to the private `documents` bucket and returns its path.
 * Person-scoped files go under personal/<profile_id>/ — the storage policies
 * gate reads on that prefix (subject or oversight roles). Everything else is
 * entity-prefixed and readable by all active users.
 */
export async function uploadDocumentFile(
  file: File,
  entityId: string,
  profileId?: string | null,
): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const prefix = profileId ? `personal/${profileId}` : entityId;
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('documents').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function getDocumentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export function useDocumentMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['documents_expiring'] });
    qc.invalidateQueries({ queryKey: ['driver_credentials'] });
    qc.invalidateQueries({ queryKey: ['audit_log'] });
  };
  const create = useMutation({
    mutationFn: async (input: DocumentInput) => {
      const { error } = await supabase.from('documents').insert(input);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<DocumentInput> }) => {
      const { error } = await supabase.from('documents').update(input).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('documents').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useDocumentsExpiring() {
  return useQuery({
    queryKey: ['documents_expiring'],
    queryFn: async (): Promise<DocumentExpiring[]> => {
      const { data, error } = await supabase
        .from('v_documents_expiring')
        .select('*')
        .order('expiration_date');
      if (error) throw error;
      return data as DocumentExpiring[];
    },
  });
}

export function useDriverCredentials() {
  return useQuery({
    queryKey: ['driver_credentials'],
    queryFn: async (): Promise<DriverCredential[]> => {
      const { data, error } = await supabase
        .from('v_driver_credentials')
        .select('*')
        .order('expiration_date', { nullsFirst: false });
      if (error) throw error;
      return data as DriverCredential[];
    },
  });
}

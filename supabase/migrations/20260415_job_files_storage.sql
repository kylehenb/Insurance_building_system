-- Create job-files storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('job-files', 'job-files', false, 52428800, ARRAY[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff'
])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files
CREATE POLICY "authenticated_can_upload_job_files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'job-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = 'tenants'
  AND (storage.foldername(name))[2] = (SELECT tenant_id::text FROM users WHERE id = auth.uid())
);

-- Allow authenticated users to view files they have access to
CREATE POLICY "authenticated_can_view_job_files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'job-files'
  AND auth.role() = 'authenticated'
  AND (
    -- User can view files from their tenant
    (storage.foldername(name))[2] = (SELECT tenant_id::text FROM users WHERE id = auth.uid())
  )
);

-- Allow authenticated users to delete files they uploaded
CREATE POLICY "authenticated_can_delete_job_files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'job-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[2] = (SELECT tenant_id::text FROM users WHERE id = auth.uid())
);

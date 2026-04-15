-- Create job-files storage bucket (if it doesn't exist)
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

-- Drop existing policies if they exist, then create new ones
DO $$
BEGIN
  -- Drop upload policy if exists
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'authenticated_can_upload_job_files' 
    AND tablename = 'objects' 
    AND schemaname = 'storage'
  ) THEN
    DROP POLICY "authenticated_can_upload_job_files" ON storage.objects;
  END IF;

  -- Drop view policy if exists
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'authenticated_can_view_job_files' 
    AND tablename = 'objects' 
    AND schemaname = 'storage'
  ) THEN
    DROP POLICY "authenticated_can_view_job_files" ON storage.objects;
  END IF;

  -- Drop delete policy if exists
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'authenticated_can_delete_job_files' 
    AND tablename = 'objects' 
    AND schemaname = 'storage'
  ) THEN
    DROP POLICY "authenticated_can_delete_job_files" ON storage.objects;
  END IF;
END $$;

-- Allow authenticated users to upload files
CREATE POLICY "authenticated_can_upload_job_files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'job-files'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to view files
CREATE POLICY "authenticated_can_view_job_files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'job-files'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete files
CREATE POLICY "authenticated_can_delete_job_files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'job-files'
  AND auth.role() = 'authenticated'
);

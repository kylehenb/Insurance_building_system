-- Create photos storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

-- Enable RLS
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to photos
CREATE POLICY "Allow public read access to photos"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'photos');

-- Policy: Allow authenticated users to upload photos
CREATE POLICY "Allow authenticated users to upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Allow authenticated users to delete their own photos
CREATE POLICY "Allow authenticated users to delete their own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

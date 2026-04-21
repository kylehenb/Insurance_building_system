-- Create tenant-assets storage bucket for logos and other tenant files
-- This bucket will store tenant-specific assets like logos

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-assets', 'tenant-assets', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Drop policies if they exist
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Tenant Full Access" ON storage.objects;

-- Grant public access to read from the bucket
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'tenant-assets');

-- Grant authenticated users full access to tenant-assets bucket
CREATE POLICY "Tenant Full Access"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'tenant-assets')
WITH CHECK (bucket_id = 'tenant-assets');

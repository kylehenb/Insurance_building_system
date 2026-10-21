-- Photos bucket: signed-in users may only upload, change or delete photos in
-- their own tenant's folder (tech spec v3.3 §5). Additive only.
--
-- The existing photos policies let any signed-in user write or delete
-- anywhere in the bucket. These RESTRICTIVE policies are ANDed with them for
-- INSERT / UPDATE / DELETE. Reading is unchanged (the bucket is public-read
-- by design, and the app also signs URLs), and the service role (field app
-- uploads via /api/field/[inspectionId]/photos) bypasses RLS as before.
--
-- Both path layouts in use are allowed:
--   tenants/{tenant_id}/...   field app (server)
--   {tenant_id}/...           Photos tab and report photo uploads (browser)
-- Checked before writing: all 8,053 existing photos are under one of these
-- for the only tenant.

CREATE POLICY photos_tenant_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id <> 'photos'
    OR (storage.foldername(name))[1] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

CREATE POLICY photos_tenant_update ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id <> 'photos'
    OR (storage.foldername(name))[1] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  )
  WITH CHECK (
    bucket_id <> 'photos'
    OR (storage.foldername(name))[1] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

CREATE POLICY photos_tenant_delete ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    bucket_id <> 'photos'
    OR (storage.foldername(name))[1] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

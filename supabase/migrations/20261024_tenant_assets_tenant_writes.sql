-- tenant-assets bucket: signed-in users may only upload, change or delete
-- files in their own tenant's folder (tech spec v3.3 §5). Additive only.
--
-- The existing "Tenant Full Access" policy lets any signed-in user write or
-- delete anywhere in the bucket. These RESTRICTIVE policies are ANDed with it
-- for INSERT / UPDATE / DELETE. Reading is unchanged: the bucket is
-- public-read because logos are shown in emails and PDFs.
--
-- Path layout: tenants/{tenant_id}/... (Settings → Tenant logo uploads,
-- with upsert, so both INSERT and UPDATE are covered). Checked before
-- writing: both existing files are under the only tenant's folder.

CREATE POLICY tenant_assets_tenant_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id <> 'tenant-assets'
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

CREATE POLICY tenant_assets_tenant_update ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id <> 'tenant-assets'
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  )
  WITH CHECK (
    bucket_id <> 'tenant-assets'
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

CREATE POLICY tenant_assets_tenant_delete ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    bucket_id <> 'tenant-assets'
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

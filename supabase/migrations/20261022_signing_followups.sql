-- E-signing follow-ups + storage tenant scoping (tech spec v3.3 §4.32, §5).
-- Additive only: no existing column, policy or row is dropped or changed.

-- ── signing_requests: reminders switch and who actually signed ─────────────

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true,
    -- automatic reminders (every 7 days, max 3); the office can turn them off per request
  ADD COLUMN IF NOT EXISTS signed_name TEXT,
    -- the name the signer confirmed on the signing page (may differ from signer_name)
  ADD COLUMN IF NOT EXISTS signer_capacity TEXT
    CHECK (signer_capacity IN ('owner', 'joint_owner', 'authorised_person'));
    -- owner named on the document | joint owner (e.g. spouse) | authorised person signing for the owner

-- ── Storage: scope private buckets to the user's tenant folder ─────────────
-- The existing job-files / irc-master policies only check "signed in". These
-- RESTRICTIVE policies are ANDed with them, so a signed-in user can only read,
-- upload, change or delete objects under tenants/{their tenant_id}/ in those
-- buckets. Other buckets are unaffected. The service role bypasses RLS as before.
-- Checked before writing: all 683 job-files objects are under
-- tenants/{tenant_id}/, irc-master is empty, and every upload path in the app
-- starts tenants/{tenantId}/.

CREATE POLICY private_buckets_tenant_scope ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    bucket_id NOT IN ('job-files', 'irc-master')
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  )
  WITH CHECK (
    bucket_id NOT IN ('job-files', 'irc-master')
    OR (
      (storage.foldername(name))[1] = 'tenants'
      AND (storage.foldername(name))[2] = (SELECT users.tenant_id::text FROM public.users WHERE users.id = auth.uid())
    )
  );

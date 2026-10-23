-- Email signature (Settings → Email Templates → Signature). Additive only.
--
-- email_signature              rich text (the editor's HTML subset, lib/email/rich-text.ts)
-- email_signature_image_path   logo in the public tenant-assets bucket,
--                              tenants/{tenant_id}/email/signature-{n}.png — a
--                              new file per upload, so emails already sent
--                              keep showing the image they were sent with
-- email_signature_image_width/height  display size in px (Outlook needs both)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS email_signature text,
  ADD COLUMN IF NOT EXISTS email_signature_image_path text,
  ADD COLUMN IF NOT EXISTS email_signature_image_width integer,
  ADD COLUMN IF NOT EXISTS email_signature_image_height integer;

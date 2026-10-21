-- E-signing: the signer page shows the real document pages as images
-- (tech spec v3.3 §5, §10a). Page images are stored next to the source PDF in
-- the private 'signed-documents' bucket:
--   tenants/{tenantId}/signing/{requestId}/pages/page-{n}.png
-- The bucket only accepted PDFs, so allow PNG too. Nothing else changes: the
-- bucket stays private with no storage policies (service role only).

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/pdf', 'image/png']
WHERE id = 'signed-documents';

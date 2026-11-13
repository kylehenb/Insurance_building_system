-- Bindi Co field app voice notes (app/api/midcity/voice): each recorded section's
-- audio, kept privately in case it needs listening back to. Written only by the
-- server (service role), under tenants/{tenant_id}/inspections/{id}/voice/.
-- Until this is run, recording still works: the text comes back, the audio isn't kept.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-notes', 'voice-notes', false, 26214400, ARRAY[
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav'
])
ON CONFLICT (id) DO NOTHING;

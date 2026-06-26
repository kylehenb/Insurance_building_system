ALTER TABLE photos ADD COLUMN IF NOT EXISTS rotation INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN photos.rotation IS 'Display rotation in degrees (0, 90, 180, 270). Applied client-side via CSS transform.';

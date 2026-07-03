ALTER TABLE photos ADD COLUMN IF NOT EXISTS crop_x FLOAT NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS crop_y FLOAT NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS crop_scale FLOAT NOT NULL DEFAULT 1;

COMMENT ON COLUMN photos.crop_x IS 'Horizontal pan offset as % of container width for CSS translate(). 0 = centered.';
COMMENT ON COLUMN photos.crop_y IS 'Vertical pan offset as % of container height for CSS translate(). 0 = centered.';
COMMENT ON COLUMN photos.crop_scale IS 'Zoom scale factor. 1.0 = no zoom (contain). >1 = zoomed in.';

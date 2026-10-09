-- Loss (claim) type becomes a fixed list — see lib/loss-types.ts, which must stay in
-- sync with the CHECK constraints below.
--
-- 1. One-off cleanup: map the existing free-text values on jobs, reports and
--    insurer_orders onto the list. Ambiguous values were mapped from each claim's
--    description / report findings:
--      "Ceiling Damage"        → Storm or Rainwater   (report found stormwater ingress)
--      "Collapse"              → Pets or Vermin       (termite-related garage collapse)
--      "Plumbing"              → Other                (service disconnect for cabinet maker)
--      "Storm — falling tree"  → Impact by Falling Trees
--      "Water Damage"/"Water Ingress" → Escape of Liquids (burst taps/pipes, shower leaks)
--    Anything else not on the list is cleared to NULL.
-- 2. CHECK constraints so only list values (or NULL) can be stored from now on.
--
-- Re-runnable: the mapping is idempotent and constraints are dropped/re-added.

CREATE OR REPLACE FUNCTION pg_temp.map_loss_type(v TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN v IS NULL OR trim(v) = '' THEN NULL
    WHEN v IN (
      'Accidental Loss or Damage', 'Age, Wear and Tear', 'Animal', 'Burglary', 'Cracking',
      'Earthquake', 'Electric Motor Fusion', 'Escape of Liquids', 'Explosion', 'Fire or Smoke',
      'Flood', 'Glass Breakage', 'Home Warranty Defects', 'Home Warranty Uncompleted Works',
      'Impact by Animals', 'Impact by Falling Trees', 'Impact or Collision by Vehicle',
      'Impact or Collision by Watercraft', 'Lightning or Thunderbolt', 'Maintenance',
      'Malicious Act or Vandalism', 'Mould', 'Other', 'Pets or Vermin', 'Rectification',
      'Riot, Civil Commotion or Public Disturbance', 'Storm or Rainwater',
      'Theft and / or Damage by Thieves', 'Tsunami'
    ) THEN v
    WHEN lower(v) LIKE '%falling tree%'                        THEN 'Impact by Falling Trees'
    WHEN lower(v) LIKE 'storm%' OR lower(v) IN ('wind', 'rain', 'rainwater')
                                                               THEN 'Storm or Rainwater'
    WHEN lower(v) LIKE 'escape of liquid%' OR lower(v) LIKE 'burst pipe%'
      OR lower(v) IN ('water damage', 'water ingress')         THEN 'Escape of Liquids'
    WHEN lower(v) = 'fire'                                     THEN 'Fire or Smoke'
    WHEN lower(v) IN ('damage by theives', 'damage by thieves', 'theft')
                                                               THEN 'Theft and / or Damage by Thieves'
    WHEN lower(v) IN ('impact', 'impact by vehicle', 'vehicle impact')
                                                               THEN 'Impact or Collision by Vehicle'
    WHEN lower(v) = 'vandalism'                                THEN 'Malicious Act or Vandalism'
    WHEN lower(v) = 'ceiling damage'                           THEN 'Storm or Rainwater'
    WHEN lower(v) = 'collapse'                                 THEN 'Pets or Vermin'
    WHEN lower(v) = 'plumbing'                                 THEN 'Other'
    ELSE NULL
  END
$$;

UPDATE jobs           SET loss_type = pg_temp.map_loss_type(loss_type) WHERE loss_type IS DISTINCT FROM pg_temp.map_loss_type(loss_type);
UPDATE reports        SET loss_type = pg_temp.map_loss_type(loss_type) WHERE loss_type IS DISTINCT FROM pg_temp.map_loss_type(loss_type);
UPDATE insurer_orders SET loss_type = pg_temp.map_loss_type(loss_type) WHERE loss_type IS DISTINCT FROM pg_temp.map_loss_type(loss_type);

ALTER TABLE jobs           DROP CONSTRAINT IF EXISTS jobs_loss_type_valid;
ALTER TABLE reports        DROP CONSTRAINT IF EXISTS reports_loss_type_valid;
ALTER TABLE insurer_orders DROP CONSTRAINT IF EXISTS insurer_orders_loss_type_valid;

ALTER TABLE jobs ADD CONSTRAINT jobs_loss_type_valid CHECK (loss_type IS NULL OR loss_type IN (
  'Accidental Loss or Damage', 'Age, Wear and Tear', 'Animal', 'Burglary', 'Cracking',
  'Earthquake', 'Electric Motor Fusion', 'Escape of Liquids', 'Explosion', 'Fire or Smoke',
  'Flood', 'Glass Breakage', 'Home Warranty Defects', 'Home Warranty Uncompleted Works',
  'Impact by Animals', 'Impact by Falling Trees', 'Impact or Collision by Vehicle',
  'Impact or Collision by Watercraft', 'Lightning or Thunderbolt', 'Maintenance',
  'Malicious Act or Vandalism', 'Mould', 'Other', 'Pets or Vermin', 'Rectification',
  'Riot, Civil Commotion or Public Disturbance', 'Storm or Rainwater',
  'Theft and / or Damage by Thieves', 'Tsunami'
));

ALTER TABLE reports ADD CONSTRAINT reports_loss_type_valid CHECK (loss_type IS NULL OR loss_type IN (
  'Accidental Loss or Damage', 'Age, Wear and Tear', 'Animal', 'Burglary', 'Cracking',
  'Earthquake', 'Electric Motor Fusion', 'Escape of Liquids', 'Explosion', 'Fire or Smoke',
  'Flood', 'Glass Breakage', 'Home Warranty Defects', 'Home Warranty Uncompleted Works',
  'Impact by Animals', 'Impact by Falling Trees', 'Impact or Collision by Vehicle',
  'Impact or Collision by Watercraft', 'Lightning or Thunderbolt', 'Maintenance',
  'Malicious Act or Vandalism', 'Mould', 'Other', 'Pets or Vermin', 'Rectification',
  'Riot, Civil Commotion or Public Disturbance', 'Storm or Rainwater',
  'Theft and / or Damage by Thieves', 'Tsunami'
));

ALTER TABLE insurer_orders ADD CONSTRAINT insurer_orders_loss_type_valid CHECK (loss_type IS NULL OR loss_type IN (
  'Accidental Loss or Damage', 'Age, Wear and Tear', 'Animal', 'Burglary', 'Cracking',
  'Earthquake', 'Electric Motor Fusion', 'Escape of Liquids', 'Explosion', 'Fire or Smoke',
  'Flood', 'Glass Breakage', 'Home Warranty Defects', 'Home Warranty Uncompleted Works',
  'Impact by Animals', 'Impact by Falling Trees', 'Impact or Collision by Vehicle',
  'Impact or Collision by Watercraft', 'Lightning or Thunderbolt', 'Maintenance',
  'Malicious Act or Vandalism', 'Mould', 'Other', 'Pets or Vermin', 'Rectification',
  'Riot, Civil Commotion or Public Disturbance', 'Storm or Rainwater',
  'Theft and / or Damage by Thieves', 'Tsunami'
));

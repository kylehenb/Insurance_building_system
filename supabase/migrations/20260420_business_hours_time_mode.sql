-- Business Hours & Time Mode System
-- Adds new automation_config keys for time-aware delivery gating and delay calculation
-- Renames Gary hour-based keys to day-based keys

-- Insert new business hours and time mode config for all existing tenants
INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'business_hours_start',
  '07:00',
  'Start of business day HH:MM 24hr. Used for business_hours mode delivery gating and business_days delay calculation.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'business_hours_end',
  '17:30',
  'End of business day HH:MM 24hr.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'business_days',
  '1,2,3,4,5',
  'ISO weekday numbers counted as business days. 1=Mon 7=Sun. Comma-separated.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'public_holidays',
  '[]',
  'JSON array of YYYY-MM-DD strings. Manually maintained annually. Excluded from business_days calculations.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'waking_hours_start',
  '07:00',
  'Earliest time for homeowner/insured comms. Any day of week.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'waking_hours_end',
  '20:00',
  'Latest time for homeowner/insured comms.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'urgent_hours_start',
  '05:00',
  'Earliest time for urgent mode comms. Default 5am. Urgent is NOT unrestricted.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'urgent_hours_end',
  '22:00',
  'Latest time for urgent mode comms. Default 10pm.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO automation_config (tenant_id, key, value, description)
SELECT 
  id,
  'urgent_all_days',
  'true',
  'If true urgent mode runs all 7 days. If false respects business_days setting.'
FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

-- Rename and revalue the three Gary hour-based keys to day-based keys
UPDATE automation_config 
SET key = 'gary_reminder_1_days', value = '1'
WHERE key = 'gary_reminder_1_hours';

UPDATE automation_config 
SET key = 'gary_final_nudge_days', value = '2'
WHERE key = 'gary_final_nudge_hours';

UPDATE automation_config 
SET key = 'gary_response_deadline_days', value = '2'
WHERE key = 'gary_response_deadline_hours';

-- Update descriptions for the renamed keys
UPDATE automation_config 
SET description = 'Gary reminder 1 fires after this many business days (not hours)'
WHERE key = 'gary_reminder_1_days';

UPDATE automation_config 
SET description = 'Gary final nudge fires after this many business days (not hours)'
WHERE key = 'gary_final_nudge_days';

UPDATE automation_config 
SET description = 'Gary escalation deadline after this many business days (not hours)'
WHERE key = 'gary_response_deadline_days';

-- Add LDR (Leak Detection Report) prompt to existing tenants
-- This migration adds the LDR report generation prompt to all existing tenants

DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM tenants LOOP
    -- Insert LDR prompt if it doesn't already exist for this tenant
    INSERT INTO prompts (tenant_id, key, name, category, report_type, system_prompt, notes)
    VALUES (
      tenant_record.id,
      'report_ldr',
      'Leak Detection Report Generation',
      'report',
      'LDR',
      'You are a specialist water damage and leak detection assessor. Generate a detailed leak detection report focusing on: leak location and source identification, investigation methods used (visual inspection, moisture meters, pressure testing, camera inspection), water type classification, damage assessment, and repair recommendations. Include technical details about the investigation process and clear conclusions about the cause of the leak.',
      'Specialized for leak detection reports'
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;
  END LOOP;
END;
$$;

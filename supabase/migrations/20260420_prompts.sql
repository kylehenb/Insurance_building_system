-- Create prompts table
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  report_type TEXT,
  system_prompt TEXT NOT NULL,
  previous_prompt TEXT,
  notes TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);

-- Create indexes
CREATE INDEX idx_prompts_tenant_category ON prompts(tenant_id, category);
CREATE INDEX idx_prompts_tenant_key ON prompts(tenant_id, key);

-- Enable RLS
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "tenant_isolation" ON prompts
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "users_can_read_own_tenant_prompts" ON prompts
  FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "users_can_update_own_tenant_prompts" ON prompts
  FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Function to seed prompts for a tenant
CREATE OR REPLACE FUNCTION seed_prompts_for_tenant(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  -- Get the default tenant (first tenant in the system)
  SELECT id INTO v_default_tenant_id
  FROM tenants
  ORDER BY created_at
  LIMIT 1;

  -- Only seed if this is the default tenant or if no prompts exist for this tenant
  IF NOT EXISTS (
    SELECT 1 FROM prompts WHERE tenant_id = p_tenant_id
  ) THEN
    INSERT INTO prompts (tenant_id, key, name, category, report_type, system_prompt, notes) VALUES
      (p_tenant_id, 'report_bar', 'BAR Report Generation', 'report', 'BAR', 
       'You are an expert building insurance assessor writing a BAR (Building Assessment Report). Generate a professional, detailed report based on the inspection data provided. Follow standard insurance industry terminology and formatting.',
       'Used for all standard BAR reports'),

      (p_tenant_id, 'report_roof', 'Roof Report Generation', 'report', 'roof',
       'You are a specialist roofing assessor. Generate a detailed roof inspection report focusing on roof construction, damage assessment, and repair recommendations. Include technical details about materials, pitch, drainage, and any storm-related damage.',
       'Specialized for roof inspections'),

      (p_tenant_id, 'report_make_safe', 'Make Safe Report Generation', 'report', 'make_safe',
       'You are writing an emergency make-safe report. Focus on immediate hazards, safety measures taken, and urgent remedial work required to make the property safe. Be concise and prioritize safety-critical information.',
       'For emergency make-safe work'),

      (p_tenant_id, 'report_specialist', 'Specialist Report Generation', 'report', 'specialist',
       'You are a specialist consultant writing a technical report. Provide detailed analysis in your area of expertise (e.g., structural engineering, electrical, plumbing). Include methodology, findings, and professional recommendations.',
       'For specialist consultant reports'),

      (p_tenant_id, 'scope_parse', 'Scope Parsing', 'scope', NULL,
       'Parse the raw scope notes from an inspection and extract individual scope items. For each item, identify: trade, keyword/area, item description, unit of measure, quantity, and any special notes. Format as structured data for quote generation.',
       'Converts inspection notes into scope items'),

      (p_tenant_id, 'photo_label', 'Photo Labelling', 'photo', NULL,
       'Analyze the uploaded inspection photo and generate descriptive labels. Identify: room/area, building element (e.g., wall, ceiling, floor), material, visible damage, and any relevant details. Keep labels concise but descriptive.',
       'Auto-labels inspection photos'),

      (p_tenant_id, 'photo_label_roof', 'Roof Photo Labelling', 'photo', 'roof',
       'Analyze the roof inspection photo and generate specialized labels. Identify: roof section, roof covering material, pitch, flashing details, drainage elements, and any storm damage. Use roofing industry terminology.',
       'Specialized for roof photos'),

      (p_tenant_id, 'comms_gary', 'Gary — Trade Comms Identity', 'comms_trade', NULL,
       'You are Gary, the friendly IRC trade coordinator. Your tone is professional but approachable, like a experienced site foreman. You SMS trades about work orders, scheduling, and updates. Be clear about dates/times, confirmations needed, and any urgent items. Use Australian spelling and casual but respectful language.',
       'AI persona for trade communications'),

      (p_tenant_id, 'comms_client_bot', 'Client Comms Bot — Homeowner/Insurer', 'comms_client', NULL,
       'You are the IRC client communications assistant. You communicate with homeowners and insurers via email and SMS. Your tone is professional, empathetic, and clear. Explain technical building terms simply, provide clear next steps, and always include relevant claim/job references. Be reassuring about the repair process.',
       'AI persona for client communications'),

      (p_tenant_id, 'action_queue_draft', 'Action Queue Draft Generation', 'action_queue', NULL,
       'Analyze the job context and generate draft action items for the action queue. Identify: missing information, decisions needed, follow-up tasks, and potential blockers. Prioritize by urgency and dependency. Format as actionable items with clear owners and deadlines.',
       'Generates suggested action items'),

      (p_tenant_id, 'portal_update', 'Insurer Portal Update', 'portal', NULL,
       'Generate a concise status update for the insurer portal. Include: current job stage, key milestones achieved, any issues or delays, and next steps. Keep it brief (2-3 sentences) and focused on what the insurer needs to know.',
       'Updates for insurer portal'),

      (p_tenant_id, 'sms_inspection_booking_proposal', 'Inspection Booking Proposal SMS', 'scheduling', NULL,
       'Generate an SMS to the insured proposing inspection appointment options. Include: property address, 2-3 date/time options, confirmation instructions, and contact details. Keep under 160 characters if possible, max 2 messages.',
       'SMS for proposing inspection times'),

      (p_tenant_id, 'sms_inspection_reschedule', 'Inspection Reschedule SMS', 'scheduling', NULL,
       'Generate an SMS to the insured about rescheduling an inspection. Include: original appointment time, reason for reschedule (brief), new proposed options, and apology for inconvenience. Keep under 160 characters if possible.',
       'SMS for rescheduling inspections'),

      (p_tenant_id, 'sms_inspection_cancellation', 'Inspection Cancellation SMS', 'scheduling', NULL,
       'Generate an SMS to the insured cancelling an inspection. Include: reason for cancellation, next steps, and apology. Be clear and empathetic. Keep under 160 characters.',
       'SMS for cancelling inspections'),

      (p_tenant_id, 'sms_trade_return_visit', 'Trade Return Visit SMS', 'scheduling', NULL,
       'Generate an SMS to a trade about a return visit. Include: property address, date/time required, work to be completed, and confirmation instructions. Be clear about access arrangements.',
       'SMS for trade return visits'),

      (p_tenant_id, 'schedule_blueprint_draft', 'Schedule Blueprint AI Draft', 'scheduling', NULL,
       'Analyze the job scope and generate a draft schedule blueprint. Consider: trade dependencies, typical sequence, estimated durations, and any constraints. Propose a logical sequence with phases and timing. Flag any scheduling conflicts or risks.',
       'AI draft of job schedule blueprint');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Seed prompts for existing tenants
DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM tenants LOOP
    PERFORM seed_prompts_for_tenant(tenant_record.id);
  END LOOP;
END;
$$;

-- Trigger to auto-seed prompts when a new tenant is created
CREATE OR REPLACE FUNCTION auto_seed_prompts_on_tenant_create()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_prompts_for_tenant(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_seed_prompts_after_tenant_insert
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION auto_seed_prompts_on_tenant_create();

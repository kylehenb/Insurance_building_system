-- Add scope_field_parse prompt to prompts table
-- This replaces the hardcoded scope parsing prompt in the field app submit route

DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM tenants LOOP
    -- Insert scope_field_parse prompt if it doesn't already exist for this tenant
    INSERT INTO prompts (tenant_id, key, name, category, report_type, system_prompt, notes)
    VALUES (
      tenant_record.id,
      'scope_field_parse',
      'Field App Scope Parsing',
      'scope',
      NULL,
      'You are a building insurance scope parser. Parse the following field inspection scope notes into structured scope items.

Job Context:
- Insurer: {insurer}
- Loss Type: {loss_type}

Scope Notes:
{scope_notes}

Return a JSON array of scope items. Each item must have:
- room: room name from the notes
- trade: trade category (e.g. "Carpentry", "Painting", "Tiling", "Plumbing", "Electrical", "Roofing", "Plastering", "Flooring", "General")
- keyword: short keyword (e.g. "replace-ceiling", "paint-walls", "replace-tiles")
- item_description: clear, professional description of the work
- qty: quantity as a number (null if not determinable)
- unit: unit of measure (e.g. "m2", "lm", "ea", "hrs", "m3") or null

Rules:
- One entry per scope item
- If an item mentions dimensions from the room (L×W), calculate m2 for area items
- Use professional trade terminology
- Return ONLY the JSON array, no other text

Example:
[{"room":"Living Room","trade":"Plastering","keyword":"replace-ceiling","item_description":"Supply and replace water-damaged plasterboard ceiling lining","qty":24,"unit":"m2"}]',
      'Parses field app scope notes into structured scope items for quote generation. Used when field app is submitted.'
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;
  END LOOP;
END $$;

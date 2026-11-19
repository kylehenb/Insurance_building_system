-- The order acknowledgement says what we'll do with a line for each thing the
-- order asks for ({work_type_lines}; lib/insurer-orders/acknowledgement-lines.ts).
-- The lines are edited with the template and saved on it: { "make_safe": "...",
-- "BAR": "..." }, only those that differ from what the version inherits.
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS work_type_lines JSONB;

-- Saved acknowledgements had the BAR line written into the message; it
-- becomes the placeholder, so a make safe gets the make safe line instead.
UPDATE email_templates
SET body_template = replace(body_template,
      'We will contact the insured to arrange an appointment and will update you once it has been scheduled.',
      '{work_type_lines}'),
    updated_at = now()
WHERE send_type = 'order_acknowledgement'
  AND body_template LIKE '%We will contact the insured to arrange an appointment and will update you once it has been scheduled.%'
  AND body_template NOT LIKE '%{work_type_lines}%';

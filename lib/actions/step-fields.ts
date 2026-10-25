// What a person can see and change on an action card step, read from its
// tool's input schema: the step's details as a form (lib/actions/steps.ts,
// components/actions/StepPanel.tsx), and which of them a change may set when
// the step runs (lib/actions/confirm.ts). Pure — safe for client code.

export type StepFieldType = 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'list'

export type StepField = {
  key: string
  label: string
  type: StepFieldType
  options?: string[]
  hint?: string
  value: string | number | boolean | null
}

type Schema = { type?: string; enum?: unknown[]; description?: string; items?: { type?: string } }

/** Never changed by hand: which conversation or message, and the tools' own "are you sure" switches */
const FIXED = new Set(['conversation_id', 'message_id', 'draft_only', 'draft_id', 'send_anyway', 'resend'])
/** Record ids (work_order_id, quote_ids…) — the preview shows what they are */
const ID_KEY = /_ids?$/

const LONG = new Set(['body', 'note', 'special_instructions', 'reason'])

const LABELS: Record<string, string> = {
  to: 'To', cc: 'Cc', bcc: 'Bcc', send_at: 'Send at (Perth time)', job_number: 'Job number', wo_type: 'Work type',
  include_photos: 'Attach the photos PDF', excess_building: 'Excess (building)', insured_email: 'Insured email',
  insured_phone: 'Insured phone', insured_name: 'Insured name', move_job_to_awaiting_stage: 'Move the job to Awaiting sign-off',
}

const label = (key: string) => LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

function fieldType(prop: Schema): StepFieldType | null {
  if (prop.type === 'string') return prop.enum ? 'select' : 'text'
  if (prop.type === 'number' || prop.type === 'integer') return 'number'
  if (prop.type === 'boolean') return 'checkbox'
  if (prop.type === 'array' && prop.items?.type === 'string') return 'list'
  return null // objects (documents, excess): shown in the preview, set by the AI
}

const properties = (schema: Record<string, unknown>) => (schema.properties ?? {}) as Record<string, Schema>

/** The step's details a person may change, as a form */
export function stepFields(schema: Record<string, unknown>, args: Record<string, unknown>): StepField[] {
  const fields: StepField[] = []
  for (const [key, prop] of Object.entries(properties(schema))) {
    if (FIXED.has(key) || ID_KEY.test(key)) continue
    let type = fieldType(prop)
    if (!type) continue
    if (type === 'text' && LONG.has(key)) type = 'textarea'
    const v = args[key]
    fields.push({
      key,
      label: label(key),
      type,
      ...(prop.enum ? { options: prop.enum.map(String) } : {}),
      ...(prop.description ? { hint: prop.description } : {}),
      value: Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null,
    })
  }
  return fields
}

/** Names of the arguments a change may set */
export function editableKeys(schema: Record<string, unknown>): string[] {
  return stepFields(schema, {}).map(f => f.key)
}

/**
 * Keeps only the changes a person may make, as the tool expects them
 * (numbers, yes/no, lists). An empty value clears the argument (null), so
 * the tool uses its default.
 */
export function cleanEdits(schema: Record<string, unknown>, edits: Record<string, unknown> | undefined): Record<string, unknown> {
  const props = properties(schema)
  const out: Record<string, unknown> = {}
  for (const key of editableKeys(schema)) {
    if (!edits || !(key in edits)) continue
    const v = edits[key]
    const type = fieldType(props[key])
    if (v === null || v === '' || v === undefined) { out[key] = null; continue }
    if (type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
      if (Number.isFinite(n)) out[key] = n
    } else if (type === 'checkbox') {
      out[key] = v === true || v === 'true'
    } else if (type === 'list') {
      out[key] = (Array.isArray(v) ? v.map(String) : String(v).split(',')).map(s => s.trim()).filter(Boolean)
    } else if (typeof v === 'string') {
      out[key] = v
    }
  }
  return out
}

/** The step's arguments with those changes made (cleared ones taken out) */
export function applyEdits(args: Record<string, unknown>, cleaned: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args, ...cleaned }
  for (const [k, v] of Object.entries(cleaned)) if (v === null) delete next[k]
  return next
}

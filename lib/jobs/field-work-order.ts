import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { trackAi } from '@/lib/health/ai-usage'
import { logError } from '@/lib/health/errors'
import { createFieldAppJob, FieldJobCreateError, type FieldJobCreated } from './field-job-create'

// A builder's work order (the PDF attached to their email, or a photo or
// screenshot of it) turned into a Bindi Co job: the AI reads the reference,
// address, insured and claim details, the job is made (or the one already made
// from it is reused) and the work order is kept in the job's files.
// Used by the field app's New screen and by the iPhone share-sheet Shortcut
// (POST /api/midcity/work-order).

type Service = SupabaseClient<Database>

export const WORK_ORDER_MODEL = 'claude-sonnet-5-5'
const MAX_BYTES = 20 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type ImageType = typeof IMAGE_TYPES[number]

export interface WorkOrderFile {
  data: Uint8Array
  /** application/pdf or an image type */
  mimeType: string
  fileName?: string
}

export interface WorkOrderDetails {
  reference: string
  address: string
  insuredName: string | null
  insuredPhone: string | null
  insuredEmail: string | null
  claimNumber: string | null
  dateOfLoss: string | null
  description: string | null
  instructions: string | null
}

export interface WorkOrderJob extends FieldJobCreated {
  details: WorkOrderDetails
}

/** The file's type as the AI takes it, or null when it isn't a PDF or picture */
export function workOrderType(mimeType: string, fileName = ''): 'application/pdf' | ImageType | null {
  const type = mimeType.toLowerCase().replace('image/jpg', 'image/jpeg')
  if (type === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'application/pdf'
  if ((IMAGE_TYPES as readonly string[]).includes(type)) return type as ImageType
  if (/\.(jpe?g)$/i.test(fileName)) return 'image/jpeg'
  if (/\.png$/i.test(fileName)) return 'image/png'
  return null
}

const PROMPT = `This is a work order from an insurance builder, asking for a roof inspection and report. Read it and return the job's details.

- reference: the builder's job / work order / reference number for this job (prefer the builder's job or work order number over the insurer's claim number)
- address: the full property address to inspect (street, suburb, state, postcode)
- insuredName: the insured / homeowner / customer name(s)
- insuredPhone: their best phone number
- insuredEmail: their email
- claimNumber: the insurer's claim number, if shown separately from the reference
- dateOfLoss: the date of loss / event as YYYY-MM-DD (dates are Australian, day first)
- description: what happened / the damage described, briefly
- instructions: instructions for us (access, contact, what to report on), briefly

Use null for anything not on the work order. Never guess a value.
Return ONLY a JSON object with exactly these keys, no markdown fences:
{"reference":"","address":"","insuredName":null,"insuredPhone":null,"insuredEmail":null,"claimNumber":null,"dateOfLoss":null,"description":null,"instructions":null}`

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null)

/** The details from the AI's reply, or null when it can't be read */
export function parseWorkOrderReply(reply: string): WorkOrderDetails | null {
  const match = reply.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw: Record<string, unknown>
  try { raw = JSON.parse(match[0]) } catch { return null }
  const dateOfLoss = str(raw.dateOfLoss)
  return {
    reference: str(raw.reference) ?? '',
    address: str(raw.address) ?? '',
    insuredName: str(raw.insuredName),
    insuredPhone: str(raw.insuredPhone),
    insuredEmail: str(raw.insuredEmail),
    claimNumber: str(raw.claimNumber),
    dateOfLoss: dateOfLoss && /^\d{4}-\d{2}-\d{2}$/.test(dateOfLoss) ? dateOfLoss : null,
    description: str(raw.description),
    instructions: str(raw.instructions),
  }
}

/** Reads a work order's details with the AI */
export async function readWorkOrder(file: WorkOrderFile, tenantId?: string): Promise<WorkOrderDetails> {
  const type = workOrderType(file.mimeType, file.fileName)
  if (!type) throw new FieldJobCreateError('Share the work order PDF (or a photo or screenshot of it)', 400)
  if (file.data.byteLength === 0) throw new FieldJobCreateError('The work order file is empty', 400)
  if (file.data.byteLength > MAX_BYTES) throw new FieldJobCreateError('The work order is too big (20 MB at most)', 400)

  const data = Buffer.from(file.data).toString('base64')
  const source = type === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: type, data } }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await trackAi({ feature: 'midcity-work-order', provider: 'anthropic', model: WORK_ORDER_MODEL, tenantId }, () => anthropic.messages.create({
    model: WORK_ORDER_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT }] }],
  }))

  const reply = message.content.find(b => b.type === 'text')
  const details = reply?.type === 'text' ? parseWorkOrderReply(reply.text) : null
  if (!details) {
    await logError('midcity-work-order', new Error('Unreadable AI reply'), { tenantId, detail: { reply: reply?.type === 'text' ? reply.text.slice(0, 300) : null } })
    throw new FieldJobCreateError('Couldn\'t read the work order — try again, or make the job by hand', 502)
  }
  if (!details.reference || !details.address) {
    const missing = [!details.reference && 'job reference', !details.address && 'property address'].filter(Boolean).join(' or ')
    throw new FieldJobCreateError(`Couldn't find the ${missing} on this work order — make the job by hand`, 422)
  }
  return details
}

/** Reads the work order, makes the job (or reuses the one already made from it) and keeps the work order in its files */
export async function createJobFromWorkOrder(service: Service, params: { tenantId: string; userId: string | null; file: WorkOrderFile }): Promise<WorkOrderJob> {
  const { tenantId, userId, file } = params
  const details = await readWorkOrder(file, tenantId)
  const job = await createFieldAppJob(service, tenantId, {
    reference: details.reference,
    address: details.address,
    insuredName: details.insuredName,
    insuredPhone: details.insuredPhone,
    insuredEmail: details.insuredEmail,
    claimNumber: details.claimNumber,
    dateOfLoss: details.dateOfLoss,
    claimDescription: details.description,
    specialInstructions: details.instructions,
  }, { reuseExisting: true })
  if (!job.existing) await keepWorkOrder(service, tenantId, userId, job.jobId, details.reference, file)
  return { ...job, details }
}

/** Saves the work order in the job's files. A failure is logged, never fails the job. */
async function keepWorkOrder(service: Service, tenantId: string, userId: string | null, jobId: string, reference: string, file: WorkOrderFile) {
  const type = workOrderType(file.mimeType, file.fileName) ?? 'application/pdf'
  const ext = type === 'application/pdf' ? 'pdf' : type.split('/')[1].replace('jpeg', 'jpg')
  const fileName = (file.fileName?.trim() || `Work order ${reference}.${ext}`).slice(0, 120)
  const storagePath = `tenants/${tenantId}/jobs/${jobId}/docs/${Date.now()}-${fileName.replace(/[^\w.\-]/g, '_')}`
  try {
    const { error: uploadErr } = await service.storage.from('job-files').upload(storagePath, file.data, { contentType: type })
    if (uploadErr) throw uploadErr
    const { error } = await service.from('job_files').insert({
      tenant_id: tenantId,
      job_id: jobId,
      description: 'Builder\'s work order',
      file_name: fileName,
      file_kind: type === 'application/pdf' ? 'PDF' : type.split('/')[1].toUpperCase().replace('WEBP', 'WebP'),
      storage_path: storagePath,
      mime_type: type,
      size_bytes: file.data.byteLength,
      added_by: userId,
      is_system_generated: true,
    })
    if (error) throw error
  } catch (err) {
    await logError('midcity-work-order', err, { tenantId, jobId, detail: { step: 'keep work order' } })
  }
}

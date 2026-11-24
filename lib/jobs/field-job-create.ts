import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { FIELD_APP_INSURER, isFieldAppJob } from './field-app'

// Makes a Bindi Co (Midcity field app) job and its inspection. One way for
// every route that makes one: New (POST /api/midcity/jobs), the schedule
// screenshot (bulk-jobs) and a builder's work order (work-order).

type Service = SupabaseClient<Database>

export class FieldJobCreateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'FieldJobCreateError'
  }
}

export interface FieldJobInput {
  /** The builder's or insurer's reference, kept as the job number */
  reference: string
  address: string
  startTime?: string | null
  insuredName?: string | null
  insuredPhone?: string | null
  insuredEmail?: string | null
  claimNumber?: string | null
  /** YYYY-MM-DD */
  dateOfLoss?: string | null
  claimDescription?: string | null
  specialInstructions?: string | null
}

export interface FieldJobCreated {
  jobId: string
  jobNumber: string
  inspectionId: string
  /** True when a Bindi Co job with this reference was already there and was reused */
  existing: boolean
}

const text = (v: string | null | undefined, max: number) => {
  const t = (v ?? '').trim()
  return t ? t.slice(0, max) : null
}

/**
 * Makes the job and its inspection. With reuseExisting, a Bindi Co job that
 * already has this reference is returned (with its inspection) instead of
 * being made twice — sharing the same work order again just opens it.
 */
export async function createFieldAppJob(service: Service, tenantId: string, input: FieldJobInput, opts: { reuseExisting?: boolean } = {}): Promise<FieldJobCreated> {
  const reference = text(input.reference, 80)
  const address = text(input.address, 300)
  if (!reference || !address) throw new FieldJobCreateError('Builder/insurer reference and address are required', 400)

  if (opts.reuseExisting) {
    const { data: found } = await service.from('jobs')
      .select('id, job_number, insurer, inspections(id)')
      .eq('tenant_id', tenantId).eq('job_number', reference).maybeSingle()
    if (found) {
      if (!isFieldAppJob(found)) throw new FieldJobCreateError(`Another job already has the reference ${reference}`, 409)
      const inspections = (found as unknown as { inspections: Array<{ id: string }> | null }).inspections ?? []
      if (inspections[0]) return { jobId: found.id, jobNumber: found.job_number, inspectionId: inspections[0].id, existing: true }
      const inspectionId = await addInspection(service, tenantId, found.id, input.startTime)
      return { jobId: found.id, jobNumber: found.job_number, inspectionId, existing: true }
    }
  }

  const now = new Date().toISOString()
  const { data: job, error: jobError } = await service.from('jobs').insert({
    tenant_id: tenantId,
    job_number: reference,
    job_type: 'insurance',
    insurer: FIELD_APP_INSURER,
    property_address: address,
    insured_name: text(input.insuredName, 200),
    insured_phone: text(input.insuredPhone, 60),
    insured_email: text(input.insuredEmail, 200),
    claim_number: text(input.claimNumber, 80),
    date_of_loss: /^\d{4}-\d{2}-\d{2}$/.test(input.dateOfLoss ?? '') ? input.dateOfLoss : null,
    claim_description: text(input.claimDescription, 4000),
    special_instructions: text(input.specialInstructions, 4000),
    created_at: now,
  } as Database['public']['Tables']['jobs']['Insert']).select('id, job_number').single()
  if (jobError || !job) {
    if (jobError?.code === '23505') throw new FieldJobCreateError(`Another job already has the reference ${reference}`, 409)
    console.error('[field-job-create] create job error:', jobError)
    throw new FieldJobCreateError('Failed to create job', 500)
  }

  const inspectionId = await addInspection(service, tenantId, job.id, input.startTime)
  return { jobId: job.id, jobNumber: job.job_number ?? reference, inspectionId, existing: false }
}

async function addInspection(service: Service, tenantId: string, jobId: string, startTime: string | null | undefined): Promise<string> {
  const { data, error } = await service.from('inspections').insert({
    tenant_id: tenantId,
    job_id: jobId,
    status: 'appointment_confirmed',
    start_time: text(startTime, 40),
    created_at: new Date().toISOString(),
  } as Database['public']['Tables']['inspections']['Insert']).select('id').single()
  if (error || !data) {
    console.error('[field-job-create] create inspection error:', error)
    throw new FieldJobCreateError('Failed to create inspection', 500)
  }
  return data.id
}

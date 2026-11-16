import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { isFieldAppJob } from './field-app'

// A Bindi Co job's details as set when it was made: the builder's or insurer's
// reference (kept as the job number, shown on the report as "Builder/Insurer
// Reference") and the property address. Changed from the field app's header
// (PATCH /api/midcity/jobs). Only Bindi Co's jobs (insurer Midcity) are changed here.

type Service = SupabaseClient<Database>

export class FieldJobDetailsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'FieldJobDetailsError'
  }
}

export interface FieldJobDetails { reference: string; address: string }

/** Saves a Bindi Co job's reference and address; returns them as saved */
export async function updateFieldJobDetails(service: Service, tenantId: string, jobId: string, details: FieldJobDetails): Promise<FieldJobDetails> {
  const reference = details.reference.trim().slice(0, 80)
  const address = details.address.trim().slice(0, 300)
  if (!reference || !address) throw new FieldJobDetailsError('The reference and address are both needed', 400)

  const { data: job } = await service.from('jobs').select('id, insurer').eq('id', jobId).eq('tenant_id', tenantId).maybeSingle()
  if (!job || !isFieldAppJob(job)) throw new FieldJobDetailsError('Job not found', 404)

  const { error } = await service.from('jobs').update({ job_number: reference, property_address: address }).eq('id', jobId).eq('tenant_id', tenantId)
  if (error) {
    if (error.code === '23505') throw new FieldJobDetailsError(`Another job already has the reference ${reference}`, 409)
    throw new FieldJobDetailsError('Could not save the job details', 500)
  }
  return { reference, address }
}

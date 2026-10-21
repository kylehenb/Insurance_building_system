import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logSigningEvent } from './events'
import { SigningError } from './provider'
import { effectiveStatus, type SigningRequestRow } from './types'

// Reads of the local signing record. Every query is scoped by tenant_id
// (internal routes) or by token hash (public routes).

type Service = SupabaseClient<Database>
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

export async function loadRequestForTenant(service: Service, tenantId: string, requestId: string): Promise<SigningRequestRow> {
  const { data, error } = await service
    .from('signing_requests')
    .select('*')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new SigningError(`Could not load the signing request: ${error.message}`, 500)
  if (!data) throw new SigningError('Signing request not found', 404)
  return data
}

export async function loadRequestByTokenHash(service: Service, tokenHash: string): Promise<SigningRequestRow | null> {
  const { data, error } = await service
    .from('signing_requests')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new SigningError(`Could not load the signing request: ${error.message}`, 500)
  return data
}

export async function loadJobAndTenant(service: Service, tenantId: string, jobId: string): Promise<{ job: Job; tenant: Tenant }> {
  const [jobRes, tenantRes] = await Promise.all([
    service.from('jobs').select('*').eq('id', jobId).eq('tenant_id', tenantId).maybeSingle(),
    service.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
  ])
  if (!jobRes.data) throw new SigningError('Job not found', 404)
  if (!tenantRes.data) throw new SigningError('Tenant not found', 404)
  return { job: jobRes.data, tenant: tenantRes.data }
}

/**
 * An open request past its expiry is stored as 'expired' the first time it
 * is noticed, with an audit event. Returns the (possibly updated) row.
 */
export async function persistExpiryIfDue(service: Service, row: SigningRequestRow): Promise<SigningRequestRow> {
  if (effectiveStatus(row) !== 'expired' || row.status === 'expired') return row
  const { data } = await service
    .from('signing_requests')
    .update({ status: 'expired' })
    .eq('id', row.id)
    .in('status', ['sent', 'viewed'])
    .select('*')
    .maybeSingle()
  if (data) {
    await logSigningEvent(service, { requestId: row.id, tenantId: row.tenant_id, event: 'expired', metadata: { expiresAt: row.expires_at } })
    return data
  }
  return row
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { signingDocumentLabel } from './documents/catalog'
import { logSigningEvent } from './events'
import { formatPerthDateTime } from './format'
import { SigningError, type SigningActor } from './provider'
import { loadRequestForTenant } from './repository'
import type { SigningRequestRow } from './types'

// Keeps the job's homeowner sign-off fields in step with signing requests.
//
// The job stage is never moved automatically by a signature. The office
// confirms it on the job page (confirmSignedStage), which records the
// sign-off as received and moves the job on — the same fields and stage the
// manual "Receive sign off" upload sets.

type Service = SupabaseClient<Database>

export const SIGNOFF_METHOD_ELECTRONIC = 'electronic_signature'

/**
 * Optional, chosen by the office when sending: moves a job waiting on
 * sign-off to "Awaiting Signed Document", exactly as the old Send for
 * Signature button did. Only applies from approved_awaiting_signoff.
 */
export async function markJobSignoffSent(service: Service, request: SigningRequestRow): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await service
    .from('jobs')
    .update({
      homeowner_signoff_sent_at: now,
      current_stage: 'awaiting_signed_document',
      current_stage_updated_at: now,
    } as never)
    .eq('id', request.job_id)
    .eq('tenant_id', request.tenant_id)
    .eq('current_stage', 'approved_awaiting_signoff')
    .select('id')
  if (error) {
    console.error(`[signing] moving job ${request.job_id} to awaiting_signed_document failed:`, error)
    return false
  }
  return (data ?? []).length > 0
}

/** After signing: note how and when, without touching the stage. */
export async function recordJobSignoffSigned(service: Service, request: SigningRequestRow): Promise<void> {
  const when = request.signed_at ? formatPerthDateTime(request.signed_at) : 'just now'
  const { error } = await service
    .from('jobs')
    .update({
      homeowner_signoff_method: SIGNOFF_METHOD_ELECTRONIC,
      homeowner_signoff_notes: `${signingDocumentLabel(request.document_type)} signed electronically by ${request.signer_name} on ${when} (request ${request.id}). Waiting for the office to confirm.`,
    })
    .eq('id', request.job_id)
    .eq('tenant_id', request.tenant_id)
  if (error) console.error(`[signing] recording sign-off on job ${request.job_id} failed:`, error)
}

/**
 * The office's confirmation after a signature: records the sign-off as
 * received (at the signing time) and moves the job to the document type's
 * next stage. Deterministic and human-triggered.
 */
export async function confirmSignedStage(service: Service, actor: SigningActor, requestId: string): Promise<{ stage: string }> {
  const request = await loadRequestForTenant(service, actor.tenantId, requestId)
  if (request.status !== 'signed' || !request.signed_at) throw new SigningError('This document has not been signed yet', 409)
  if (request.stage_confirmed_at) throw new SigningError('This sign-off has already been confirmed', 409)

  const nextStage = 'signed_build_schedule'
  const now = new Date().toISOString()
  const { data: job } = await service
    .from('jobs')
    .select('id, homeowner_signoff_sent_at, override_stage')
    .eq('id', request.job_id)
    .eq('tenant_id', actor.tenantId)
    .maybeSingle()
  if (!job) throw new SigningError('Job not found', 404)

  const { error } = await service
    .from('jobs')
    .update({
      homeowner_signoff_sent_at: job.homeowner_signoff_sent_at ?? request.sent_at,
      homeowner_signoff_received_at: request.signed_at,
      homeowner_signoff_method: SIGNOFF_METHOD_ELECTRONIC,
      homeowner_signoff_notes: `${signingDocumentLabel(request.document_type)} signed electronically by ${request.signer_name} on ${formatPerthDateTime(request.signed_at)} (request ${request.id}). Confirmed by the office on ${formatPerthDateTime(now)}.`,
      current_stage: nextStage,
      current_stage_updated_at: now,
    } as never)
    .eq('id', request.job_id)
    .eq('tenant_id', actor.tenantId)
  if (error) throw new SigningError(`Could not update the job: ${error.message}`, 500)

  await service
    .from('signing_requests')
    .update({ stage_confirmed_at: now, stage_confirmed_by: actor.userId })
    .eq('id', request.id)
    .eq('tenant_id', actor.tenantId)

  await logSigningEvent(service, {
    requestId: request.id,
    tenantId: actor.tenantId,
    event: 'stage_confirmed',
    actorId: actor.userId,
    metadata: { stage: nextStage, onHold: job.override_stage ?? null },
  })
  return { stage: nextStage }
}

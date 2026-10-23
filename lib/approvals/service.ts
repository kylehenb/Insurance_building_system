import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { permissionAction, type PermissionKey } from '@/lib/permissions/catalogue'
import { loadUserPermissions } from '@/lib/permissions/resolve'
import { OPERATIONS, type OperationKey, type OperationPayload } from '@/lib/approvals/operations'

// The approval queue. A user whose level for an action is "needs approval"
// gets a request here instead of the action (requestApproval). Someone allowed
// to do that action approves it — which runs it, as the requester — or
// rejects it; the requester can cancel it while it's pending.

type Service = SupabaseClient<Database>
type Row = Database['public']['Tables']['approval_requests']['Row']

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'cancelled'
export type ApprovalDecision = 'approve' | 'reject' | 'cancel'

export class ApprovalError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) {
    super(message)
    this.name = 'ApprovalError'
  }
}

export interface ApprovalRequested {
  id: string
  summary: string
  /** An identical request was already waiting — no new one was made */
  existing: boolean
  /** What to tell the person who asked */
  message: string
}

/** Records a request for an action the user needs approval for. */
export async function requestApproval<K extends OperationKey>(params: {
  tenantId: string
  userId: string
  action: PermissionKey
  operation: K
  payload: OperationPayload<K>
  via?: 'app' | 'voice'
  service?: Service
}): Promise<ApprovalRequested> {
  const service = params.service ?? createServiceClient()
  const payload = params.payload as unknown as Json

  // The same request already waiting (a double click, a voice retry)
  const { data: waiting } = await service
    .from('approval_requests').select('id, summary, payload')
    .eq('tenant_id', params.tenantId).eq('requested_by', params.userId)
    .eq('operation', params.operation).eq('status', 'pending')
  const same = (waiting ?? []).find(w => JSON.stringify(w.payload) === JSON.stringify(payload))
  if (same) {
    return { id: same.id, summary: same.summary, existing: true, message: `This is already waiting for approval: ${same.summary}.` }
  }

  const ctx = { service, tenantId: params.tenantId, requesterId: params.userId }
  let summary = permissionAction(params.action)?.label ?? params.action
  let jobId: string | null = null
  try {
    const described = await (OPERATIONS[params.operation].describe as (p: unknown, c: typeof ctx) => Promise<{ summary: string; jobId: string | null }>)(params.payload, ctx)
    summary = described.summary
    jobId = described.jobId
  } catch (err) {
    console.error(`[approvals] couldn't describe ${params.operation}:`, err)
  }

  const { data, error } = await service.from('approval_requests').insert({
    tenant_id: params.tenantId,
    action: params.action,
    operation: params.operation,
    payload,
    summary,
    job_id: jobId,
    requested_by: params.userId,
    requested_via: params.via ?? 'app',
  }).select('id').single()
  if (error || !data) throw new Error(`Could not save the approval request: ${error?.message ?? 'no row'}`)

  return { id: data.id, summary, existing: false, message: `Sent for approval: ${summary}. It will happen once an admin approves it.` }
}

export interface ApprovalView {
  id: string
  action: string
  actionLabel: string
  summary: string
  status: ApprovalStatus
  requestedBy: { id: string | null; name: string | null }
  requestedVia: string
  createdAt: string
  decidedBy: { id: string | null; name: string | null } | null
  decidedAt: string | null
  decisionNote: string | null
  result: string | null
  jobId: string | null
  /** The viewer can approve or reject it */
  canDecide: boolean
  /** The viewer asked for it and it's still pending */
  canCancel: boolean
}

/**
 * Pending requests the viewer can decide or asked for, plus recently decided
 * ones (last 14 days) for context.
 */
export async function listApprovals(tenantId: string, viewerId: string, options: { status?: 'pending' | 'all'; jobId?: string; limit?: number } = {}, service: Service = createServiceClient()): Promise<ApprovalView[]> {
  let q = service.from('approval_requests').select('*').eq('tenant_id', tenantId)
  if (options.status === 'pending') q = q.eq('status', 'pending')
  else q = q.gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
  if (options.jobId) q = q.eq('job_id', options.jobId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(options.limit ?? 50)
  if (error) throw error
  const rows = (data ?? []) as Row[]

  const userIds = [...new Set(rows.flatMap(r => [r.requested_by, r.decided_by]).filter((id): id is string => !!id))]
  const [{ data: users }, viewer] = await Promise.all([
    userIds.length ? service.from('users').select('id, name').eq('tenant_id', tenantId).in('id', userIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    loadUserPermissions(tenantId, viewerId, service),
  ])
  const names = new Map((users ?? []).map(u => [u.id, u.name]))

  return rows
    .map(r => {
      const pending = r.status === 'pending'
      const canDecide = pending && r.requested_by !== viewerId && viewer.levels[r.action as PermissionKey] === 'allowed'
      return {
        id: r.id,
        action: r.action,
        actionLabel: permissionAction(r.action)?.label ?? r.action,
        summary: r.summary,
        status: r.status as ApprovalStatus,
        requestedBy: { id: r.requested_by, name: r.requested_by ? names.get(r.requested_by) ?? null : null },
        requestedVia: r.requested_via,
        createdAt: r.created_at,
        decidedBy: r.decided_by ? { id: r.decided_by, name: names.get(r.decided_by) ?? null } : null,
        decidedAt: r.decided_at,
        decisionNote: r.decision_note,
        result: r.result,
        jobId: r.job_id,
        canDecide,
        canCancel: pending && r.requested_by === viewerId,
      }
    })
    // Pending ones only matter to people who can act on them
    .filter(v => v.status !== 'pending' || v.canDecide || v.canCancel)
}

/**
 * Approves (and runs), rejects or cancels a pending request. The request is
 * claimed with a guarded update first, so two people approving at once can't
 * run it twice.
 */
export async function decideApproval(params: {
  tenantId: string
  userId: string
  id: string
  decision: ApprovalDecision
  note?: string | null
  service?: Service
}): Promise<{ status: ApprovalStatus; result: string | null; summary: string }> {
  const service = params.service ?? createServiceClient()
  const { data: row, error } = await service
    .from('approval_requests').select('*').eq('tenant_id', params.tenantId).eq('id', params.id).maybeSingle()
  if (error) throw error
  if (!row) throw new ApprovalError('Approval request not found', 404)
  if (row.status !== 'pending') throw new ApprovalError(`This request has already been ${row.status}.`, 409)

  if (params.decision === 'cancel') {
    if (row.requested_by !== params.userId) throw new ApprovalError('Only the person who asked can cancel it.', 403)
  } else {
    if (row.requested_by === params.userId) throw new ApprovalError('You can\'t approve or reject your own request.', 403)
    const { levels } = await loadUserPermissions(params.tenantId, params.userId, service)
    if (levels[row.action as PermissionKey] !== 'allowed') {
      throw new ApprovalError(`You aren't allowed to ${(permissionAction(row.action)?.label ?? row.action).toLowerCase()}, so you can't approve it.`, 403)
    }
  }

  const status: ApprovalStatus = params.decision === 'approve' ? 'approved' : params.decision === 'reject' ? 'rejected' : 'cancelled'
  const { data: claimed, error: claimErr } = await service
    .from('approval_requests')
    .update({ status, decided_by: params.userId, decided_at: new Date().toISOString(), decision_note: params.note?.trim() || null })
    .eq('tenant_id', params.tenantId).eq('id', row.id).eq('status', 'pending')
    .select('id')
  if (claimErr) throw claimErr
  if (!claimed?.length) throw new ApprovalError('Someone else has just decided this request.', 409)
  if (params.decision !== 'approve') return { status, result: null, summary: row.summary }

  // Run it, as the person who asked
  const operation = OPERATIONS[row.operation as OperationKey]
  let result: string
  let finalStatus: ApprovalStatus = 'approved'
  if (!operation) {
    result = `Unknown operation ${row.operation}`
    finalStatus = 'failed'
  } else {
    try {
      result = await (operation.run as (p: unknown, c: object) => Promise<string>)(row.payload, { service, tenantId: params.tenantId, requesterId: row.requested_by })
    } catch (err) {
      console.error(`[approvals] ${row.id} (${row.operation}) failed:`, err)
      result = err instanceof Error ? err.message : String(err)
      finalStatus = 'failed'
    }
  }
  await service.from('approval_requests').update({ status: finalStatus, result }).eq('id', row.id)
  return { status: finalStatus, result, summary: row.summary }
}

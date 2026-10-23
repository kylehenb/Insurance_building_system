import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { permissionAction, type PermissionKey } from '@/lib/permissions/catalogue'
import { loadUserPermissions } from '@/lib/permissions/resolve'
import { OPERATIONS, type OperationKey, type OperationPayload } from '@/lib/approvals/operations'

// The who-did-what log (Settings → Activity). Every action that has a
// permission — sends, lodging, stage and excess changes, voice tool calls —
// and every approval request and decision is written here once it has
// happened: who, how (app / voice / run on approval), on which job, and what
// came of it. Recording never fails the action it records.

type Service = SupabaseClient<Database>

export type ActivityVia = 'app' | 'voice' | 'approval'
export type ActivityOutcome = 'done' | 'failed' | 'requested' | 'rejected' | 'cancelled'

export interface ActivityEntry {
  tenantId: string
  /** Who it was done as */
  userId: string | null
  /** Permission key, or approval.decide */
  action: string
  summary: string
  jobId?: string | null
  via: ActivityVia
  outcome?: ActivityOutcome
  detail?: string | null
  voiceKeyId?: string | null
  approvalId?: string | null
  approvedBy?: string | null
  service?: Service
}

const clip = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s ?? null)

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  try {
    const service = entry.service ?? createServiceClient()
    const { error } = await service.from('activity_log').insert({
      tenant_id: entry.tenantId,
      user_id: entry.userId,
      action: entry.action,
      summary: clip(entry.summary, 500) ?? '',
      job_id: entry.jobId ?? null,
      via: entry.via,
      outcome: entry.outcome ?? 'done',
      detail: clip(entry.detail, 2000),
      voice_key_id: entry.voiceKeyId ?? null,
      approval_id: entry.approvalId ?? null,
      approved_by: entry.approvedBy ?? null,
    })
    if (error) throw error
  } catch (err) {
    console.error(`[activity] couldn't record ${entry.action}:`, err)
  }
}

/** Records an app action, described the same way an approval request would be. */
export async function recordOperation<K extends OperationKey>(params: {
  tenantId: string
  userId: string | null | undefined
  action: PermissionKey
  operation: K
  payload: OperationPayload<K>
  detail?: string | null
  service?: Service
}): Promise<void> {
  let service: Service
  try {
    service = params.service ?? createServiceClient()
  } catch (err) {
    console.error(`[activity] couldn't record ${params.action}:`, err)
    return
  }
  let summary = permissionAction(params.action)?.label ?? params.action
  let jobId: string | null = null
  try {
    const described = await (OPERATIONS[params.operation].describe as (p: unknown, c: object) => Promise<{ summary: string; jobId: string | null }>)(
      params.payload, { service, tenantId: params.tenantId, requesterId: params.userId ?? null },
    )
    summary = described.summary
    jobId = described.jobId
  } catch (err) {
    console.error(`[activity] couldn't describe ${params.operation}:`, err)
  }
  await recordActivity({ tenantId: params.tenantId, userId: params.userId ?? null, action: params.action, summary, jobId, via: 'app', detail: params.detail, service })
}

export interface ActivityView {
  id: string
  createdAt: string
  user: { id: string | null; name: string | null }
  action: string
  actionLabel: string
  summary: string
  via: ActivityVia
  outcome: ActivityOutcome
  detail: string | null
  job: { id: string; number: string | null } | null
  approvedBy: string | null
  voiceKeyLabel: string | null
}

/**
 * Recent activity. Someone allowed to manage users sees everyone's; anyone
 * else sees only their own (userId is then ignored).
 */
export async function listActivity(
  tenantId: string,
  viewerId: string,
  options: { userId?: string; jobId?: string; days?: number; limit?: number } = {},
  service: Service = createServiceClient(),
): Promise<{ entries: ActivityView[]; seesEveryone: boolean }> {
  const viewer = await loadUserPermissions(tenantId, viewerId, service)
  const seesEveryone = viewer.levels['users.manage'] === 'allowed'
  const userId = seesEveryone ? options.userId : viewerId
  const days = Math.min(Math.max(options.days ?? 7, 1), 90)

  let q = service.from('activity_log').select('*').eq('tenant_id', tenantId)
    .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
  if (userId) q = q.eq('user_id', userId)
  if (options.jobId) q = q.eq('job_id', options.jobId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.min(options.limit ?? 100, 500))
  if (error) throw error
  const rows = data ?? []

  const userIds = [...new Set(rows.flatMap(r => [r.user_id, r.approved_by]).filter((id): id is string => !!id))]
  const jobIds = [...new Set(rows.map(r => r.job_id).filter((id): id is string => !!id))]
  const keyIds = [...new Set(rows.map(r => r.voice_key_id).filter((id): id is string => !!id))]
  const [{ data: users }, { data: jobs }, { data: keys }] = await Promise.all([
    userIds.length ? service.from('users').select('id, name').eq('tenant_id', tenantId).in('id', userIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    jobIds.length ? service.from('jobs').select('id, job_number').eq('tenant_id', tenantId).in('id', jobIds) : Promise.resolve({ data: [] as { id: string; job_number: string }[] }),
    keyIds.length ? service.from('voice_keys').select('id, label').eq('tenant_id', tenantId).in('id', keyIds) : Promise.resolve({ data: [] as { id: string; label: string }[] }),
  ])
  const names = new Map((users ?? []).map(u => [u.id, u.name]))
  const jobNumbers = new Map((jobs ?? []).map(j => [j.id, j.job_number]))
  const keyLabels = new Map((keys ?? []).map(k => [k.id, k.label]))

  return {
    seesEveryone,
    entries: rows.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      user: { id: r.user_id, name: r.user_id ? names.get(r.user_id) ?? null : null },
      action: r.action,
      actionLabel: r.action === 'approval.decide' ? 'Decide an approval' : permissionAction(r.action)?.label ?? r.action,
      summary: r.summary,
      via: r.via as ActivityVia,
      outcome: r.outcome as ActivityOutcome,
      detail: r.detail,
      job: r.job_id ? { id: r.job_id, number: jobNumbers.get(r.job_id) ?? null } : null,
      approvedBy: r.approved_by ? names.get(r.approved_by) ?? null : null,
      voiceKeyLabel: r.voice_key_id ? keyLabels.get(r.voice_key_id) ?? null : null,
    })),
  }
}

/**
 * Records a voice tool call that changed or sent something. The summary is
 * what the tool told Claude it did; the job comes from the same lookups the
 * approval queue uses, or the job number it was given.
 */
export async function recordVoiceCall(params: {
  tenantId: string
  userId: string
  action: PermissionKey
  tool: { name: string; title: string }
  args: Record<string, unknown>
  resultText: string
  outcome: 'done' | 'failed'
  voiceKeyId?: string
  service: Service
}): Promise<void> {
  const { service, tenantId } = params
  let jobId: string | null = null
  try {
    jobId = (await OPERATIONS['voice.tool'].describe({ tool: params.tool.name, args: params.args }, { service, tenantId, requesterId: params.userId })).jobId
    if (!jobId && typeof params.args.job_number === 'string') {
      const { data } = await service.from('jobs').select('id').eq('tenant_id', tenantId).ilike('job_number', params.args.job_number.trim()).maybeSingle()
      jobId = data?.id ?? null
    }
  } catch (err) {
    console.error(`[activity] couldn't find the job for ${params.tool.name}:`, err)
  }
  const firstLine = params.resultText.split('\n')[0].trim()
  await recordActivity({
    tenantId, userId: params.userId, action: params.action, via: 'voice', outcome: params.outcome, jobId,
    summary: `${params.tool.title}: ${firstLine}`, detail: params.resultText, voiceKeyId: params.voiceKeyId, service,
  })
}

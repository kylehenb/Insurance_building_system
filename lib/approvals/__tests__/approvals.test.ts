import { describe, it, expect, vi, beforeEach } from 'vitest'

// The approval queue: "needs approval" saves a request instead of acting, an
// approver's yes runs the very same function as the requester, and the
// guards (no self-approval, approver must be allowed, decide only once).

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let nextId = 1
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let op: { kind: 'update'; row: Row } | { kind: 'insert'; row: Row } | null = null
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op?.kind === 'insert') {
      const row = { id: `a${nextId++}`, status: 'pending', created_at: new Date().toISOString(), ...op.row }
      rows().push(row)
      return [row]
    }
    const hit = rows().filter(r => preds.every(p => p(r)))
    if (op?.kind === 'update') for (const r of hit) Object.assign(r, op.row)
    return hit.map(r => ({ ...r }))
  }
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    gte: (c: string, v: string) => { preds.push(r => String(r[c]) >= v); return b },
    in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
    insert: (row: Row) => { op = { kind: 'insert', row }; return b },
    update: (row: Row) => { op = { kind: 'update', row }; return b },
    single: async () => ({ data: run()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
  }
  return b
}
const service = { from: query }
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => service, createClient: async () => service }))

const setJobStage = vi.fn(async () => {})
vi.mock('@/lib/jobs/set-stage', () => ({ setJobStage, SetStageError: class extends Error {} }))

const { requestApproval, decideApproval, listApprovals } = await import('../service')
const { permissionGate } = await import('@/lib/permissions/http')
const { handleMcpMessage } = await import('@/lib/mcp/server')

const stageRequest = (userId = 'olivia', stage = 'repairs_in_progress') => requestApproval({
  tenantId: 't1', userId, action: 'jobs.change_stage', operation: 'job.stage', payload: { jobId: 'j1', stage },
})

beforeEach(() => {
  setJobStage.mockReset()
  db.users = [
    { id: 'kyle', tenant_id: 't1', name: 'Kyle', role: 'admin' },
    { id: 'olivia', tenant_id: 't1', name: 'Olivia', role: 'office' },
    { id: 'ian', tenant_id: 't1', name: 'Ian', role: 'inspector' },
  ]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001' }]
  db.permission_defaults = []
  // Olivia needs approval to change stages; Ian isn't allowed to
  db.user_permission_overrides = [{ tenant_id: 't1', user_id: 'olivia', action: 'jobs.change_stage', level: 'approval' }]
  db.approval_requests = []
})

describe('asking', () => {
  it('saves what to run with a plain summary, once', async () => {
    const first = await stageRequest()
    expect(first).toMatchObject({ existing: false, summary: expect.stringMatching(/^Move IRC1001 to /) })
    expect(first.message).toMatch(/^Sent for approval: Move IRC1001/)
    expect(db.approval_requests[0]).toMatchObject({ tenant_id: 't1', requested_by: 'olivia', operation: 'job.stage', job_id: 'j1', status: 'pending' })

    const again = await stageRequest()
    expect(again).toMatchObject({ id: first.id, existing: true })
    expect(db.approval_requests).toHaveLength(1)
    expect(setJobStage).not.toHaveBeenCalled()
  })

  it('queues from an app route instead of acting, still as a 403', async () => {
    const res = await permissionGate('t1', 'olivia', 'jobs.change_stage', { operation: 'job.stage', payload: { jobId: 'j1', stage: 'x' } })
    expect(res?.status).toBe(403)
    expect(await res?.json()).toMatchObject({ pendingApproval: true, approvalId: db.approval_requests[0].id, error: expect.stringMatching(/Sent for approval/) })
    expect(await permissionGate('t1', 'kyle', 'jobs.change_stage', { operation: 'job.stage', payload: { jobId: 'j1', stage: 'x' } })).toBeNull()
    const blocked = await permissionGate('t1', 'ian', 'jobs.change_stage', { operation: 'job.stage', payload: { jobId: 'j1', stage: 'x' } })
    expect(await blocked?.json()).toMatchObject({ level: 'blocked', error: expect.stringMatching(/isn't allowed/) })
    expect(db.approval_requests).toHaveLength(1)
  })

  it('queues a voice tool call instead of running it', async () => {
    const run = vi.fn()
    const tool = { name: 'move_stage', title: 'Move stage', description: '', inputSchema: {}, annotations: {}, permission: 'jobs.change_stage' as const, run }
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'move_stage', arguments: { job_number: 'IRC1001' } } },
      [tool], { supabase: service as never, tenantId: 't1', userId: 'olivia' },
    ) as { result: { content: { text: string }[]; isError: boolean } }
    expect(run).not.toHaveBeenCalled()
    expect(res.result.isError).toBe(false)
    expect(res.result.content[0].text).toMatch(/waiting for approval/)
    expect(db.approval_requests[0]).toMatchObject({ operation: 'voice.tool', requested_via: 'voice', payload: { tool: 'move_stage', args: { job_number: 'IRC1001' } } })
  })
})

describe('deciding', () => {
  it('runs the action as asked when an allowed person approves', async () => {
    const { id } = await stageRequest()
    const out = await decideApproval({ tenantId: 't1', userId: 'kyle', id, decision: 'approve' })
    expect(out).toMatchObject({ status: 'approved', result: 'Stage changed.' })
    expect(setJobStage).toHaveBeenCalledWith(service, 't1', 'j1', 'repairs_in_progress')
    expect(db.approval_requests[0]).toMatchObject({ status: 'approved', decided_by: 'kyle', result: 'Stage changed.' })
  })

  it('runs it once only', async () => {
    const { id } = await stageRequest()
    await decideApproval({ tenantId: 't1', userId: 'kyle', id, decision: 'approve' })
    await expect(decideApproval({ tenantId: 't1', userId: 'kyle', id, decision: 'approve' })).rejects.toMatchObject({ status: 409 })
    expect(setJobStage).toHaveBeenCalledTimes(1)
  })

  it('refuses self-approval and approvers who can’t do the action themselves', async () => {
    const { id } = await stageRequest()
    await expect(decideApproval({ tenantId: 't1', userId: 'olivia', id, decision: 'approve' })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/your own/) })
    await expect(decideApproval({ tenantId: 't1', userId: 'ian', id, decision: 'approve' })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/can't approve/) })
    await expect(decideApproval({ tenantId: 't2', userId: 'kyle', id, decision: 'approve' })).rejects.toMatchObject({ status: 404 })
    expect(setJobStage).not.toHaveBeenCalled()
  })

  it('rejects and cancels without running anything', async () => {
    const a = await stageRequest('olivia', 'one')
    const b = await stageRequest('olivia', 'two')
    expect(await decideApproval({ tenantId: 't1', userId: 'kyle', id: a.id, decision: 'reject', note: ' not yet ' })).toMatchObject({ status: 'rejected' })
    expect(db.approval_requests[0]).toMatchObject({ decision_note: 'not yet' })
    await expect(decideApproval({ tenantId: 't1', userId: 'kyle', id: b.id, decision: 'cancel' })).rejects.toMatchObject({ status: 403 })
    expect(await decideApproval({ tenantId: 't1', userId: 'olivia', id: b.id, decision: 'cancel' })).toMatchObject({ status: 'cancelled' })
    expect(setJobStage).not.toHaveBeenCalled()
  })

  it('marks it failed with the reason when the action fails', async () => {
    setJobStage.mockRejectedValueOnce(new Error('Job not found'))
    const { id } = await stageRequest()
    expect(await decideApproval({ tenantId: 't1', userId: 'kyle', id, decision: 'approve' })).toMatchObject({ status: 'failed', result: 'Job not found' })
    expect(db.approval_requests[0]).toMatchObject({ status: 'failed', result: 'Job not found' })
  })
})

describe('listing', () => {
  it('shows pending requests to those who can decide or cancel them', async () => {
    await stageRequest()
    const [forKyle] = await listApprovals('t1', 'kyle', { status: 'pending' }, service as never)
    expect(forKyle).toMatchObject({ canDecide: true, canCancel: false, requestedBy: { name: 'Olivia' } })
    expect((await listApprovals('t1', 'olivia', { status: 'pending' }, service as never))[0]).toMatchObject({ canDecide: false, canCancel: true })
    expect(await listApprovals('t1', 'ian', { status: 'pending' }, service as never)).toEqual([])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Personal voice keys (the connector acts as the key's owner; only a hash is
// kept; revoking stops it) and the who-did-what log they feed.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let nextId = 1
let failInserts = false
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let op: { kind: 'update'; row: Row } | { kind: 'insert'; row: Row } | null = null
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op?.kind === 'insert') {
      if (failInserts) return { data: null, error: { message: 'db down' } }
      const row = { id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...(table === 'approval_requests' ? { status: 'pending' } : {}), ...op.row }
      rows().push(row)
      return { data: [row], error: null }
    }
    const hit = rows().filter(r => preds.every(p => p(r)))
    if (op?.kind === 'update') for (const r of hit) Object.assign(r, op.row)
    return { data: hit.map(r => ({ ...r })), error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
    ilike: (c: string, v: string) => { preds.push(r => String(r[c]).toLowerCase() === v.toLowerCase()); return b },
    gte: (c: string, v: string) => { preds.push(r => String(r[c]) >= v); return b },
    in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
    insert: (row: Row) => { op = { kind: 'insert', row }; return b },
    update: (row: Row) => { op = { kind: 'update', row }; return b },
    single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  }
  return b
}
const service = { from: query }
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => service, createClient: async () => service }))
vi.mock('@/lib/jobs/set-stage', () => ({ setJobStage: async () => {}, SetStageError: class extends Error {} }))

const { createVoiceKey, revokeVoiceKey, listVoiceKeys, hashVoiceKey, VOICE_KEY_PREFIX } = await import('../keys')
const { mcpContextFor } = await import('@/lib/mcp/auth')
const { handleMcpMessage } = await import('@/lib/mcp/server')
const { recordActivity, listActivity } = await import('@/lib/activity/log')
const { requestApproval, decideApproval } = await import('@/lib/approvals/service')
const { listActivityTool } = await import('@/lib/mcp/tools/activity')

beforeEach(() => {
  failInserts = false
  vi.stubEnv('MCP_CONNECTOR_SECRET', '')
  vi.stubEnv('MCP_USER_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.users = [
    { id: 'kyle', tenant_id: 't1', name: 'Kyle', role: 'admin' },
    { id: 'olivia', tenant_id: 't1', name: 'Olivia', role: 'office' },
    { id: 'other', tenant_id: 't2', name: 'Other', role: 'admin' },
  ]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001' }]
  db.permission_defaults = []
  db.user_permission_overrides = [{ tenant_id: 't1', user_id: 'olivia', action: 'jobs.change_stage', level: 'approval' }]
  db.voice_keys = []
  db.activity_log = []
  db.approval_requests = []
})

const ctxFor = (key: string) => mcpContextFor(`Bearer ${key}`)

describe('personal voice keys', () => {
  it('stores only a hash, and the connector acts as the owner', async () => {
    const { key, view } = await createVoiceKey({ tenantId: 't1', userId: 'olivia', createdBy: 'olivia', label: '  Olivia’s   iPhone ' })
    expect(key.startsWith(VOICE_KEY_PREFIX)).toBe(true)
    expect(view).toMatchObject({ label: 'Olivia’s iPhone', hint: key.slice(-4), userName: 'Olivia' })
    expect(JSON.stringify(db.voice_keys)).not.toContain(key)
    expect(db.voice_keys[0]).toMatchObject({ key_hash: hashVoiceKey(key), user_id: 'olivia', tenant_id: 't1' })

    // No shared key configured — personal keys work on their own
    expect(await ctxFor(key)).toMatchObject({ tenantId: 't1', userId: 'olivia', voiceKeyId: view.id })
    expect(db.voice_keys[0].last_used_at).toBeTruthy()
    expect(await ctxFor(`${key}x`)).toBeNull()
    expect(await ctxFor('a'.repeat(40))).toBeNull()
  })

  it('stops working once revoked, or if the owner leaves the company', async () => {
    const a = await createVoiceKey({ tenantId: 't1', userId: 'olivia', createdBy: 'olivia', label: 'phone' })
    const b = await createVoiceKey({ tenantId: 't1', userId: 'olivia', createdBy: 'olivia', label: 'ipad' })
    await revokeVoiceKey({ tenantId: 't1', id: a.view.id, by: 'olivia', canManage: false })
    expect(await ctxFor(a.key)).toBeNull()
    expect(await listVoiceKeys('t1', 'olivia', service as never)).toHaveLength(1)

    db.users[1].tenant_id = 't2'
    expect(await ctxFor(b.key)).toBeNull()
  })

  it('lets only the owner, or someone who manages users, revoke a key', async () => {
    const { view } = await createVoiceKey({ tenantId: 't1', userId: 'kyle', createdBy: 'kyle', label: 'phone' })
    await expect(revokeVoiceKey({ tenantId: 't1', id: view.id, by: 'olivia', canManage: false })).rejects.toMatchObject({ status: 403 })
    await expect(revokeVoiceKey({ tenantId: 't2', id: view.id, by: 'other', canManage: true })).rejects.toMatchObject({ status: 404 })
    await revokeVoiceKey({ tenantId: 't1', id: view.id, by: 'olivia', canManage: true })
    expect(db.voice_keys[0]).toMatchObject({ revoked_by: 'olivia' })
  })

  it('needs a name and caps keys per person', async () => {
    await expect(createVoiceKey({ tenantId: 't1', userId: 'kyle', createdBy: 'kyle', label: '  ' })).rejects.toMatchObject({ status: 400 })
    for (let i = 0; i < 5; i++) await createVoiceKey({ tenantId: 't1', userId: 'kyle', createdBy: 'kyle', label: `k${i}` })
    await expect(createVoiceKey({ tenantId: 't1', userId: 'kyle', createdBy: 'kyle', label: 'one more' })).rejects.toThrow(/revoke one first/)
  })

  it('still accepts the shared key while it is configured', async () => {
    vi.stubEnv('MCP_CONNECTOR_SECRET', 's'.repeat(40))
    vi.stubEnv('MCP_USER_ID', 'kyle')
    expect(await ctxFor('s'.repeat(40))).toEqual({ supabase: service, tenantId: 't1', userId: 'kyle' })
  })
})

describe('activity log', () => {
  it('never fails the action it records', async () => {
    failInserts = true
    await expect(recordActivity({ tenantId: 't1', userId: 'kyle', action: 'jobs.notes', summary: 'x', via: 'app' })).resolves.toBeUndefined()
  })

  it('logs voice actions under the key’s owner, but not refusals', async () => {
    const { key, view } = await createVoiceKey({ tenantId: 't1', userId: 'kyle', createdBy: 'kyle', label: 'Kyle’s iPhone' })
    const ctx = (await ctxFor(key))!
    const tool = (text: string, isError = false) => ({
      name: 'add_job_note', title: 'Add job note', description: '', inputSchema: {}, annotations: {}, permission: 'jobs.notes' as const,
      run: async () => ({ text, isError }),
    })
    const call = (t: ReturnType<typeof tool>) => handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: t.name, arguments: { job_number: 'IRC1001', note: 'hi' } } }, [t], ctx)

    await call(tool('What should the note say?', true))
    expect(db.activity_log).toHaveLength(0)
    await call(tool('Added to IRC1001\'s notes: "hi"'))
    expect(db.activity_log[0]).toMatchObject({
      user_id: 'kyle', action: 'jobs.notes', via: 'voice', outcome: 'done', job_id: 'j1', voice_key_id: view.id,
      summary: 'Add job note: Added to IRC1001\'s notes: "hi"',
    })
  })

  it('logs the request, and the approved action as the requester’s with who approved it', async () => {
    const { id } = await requestApproval({ tenantId: 't1', userId: 'olivia', action: 'jobs.change_stage', operation: 'job.stage', payload: { jobId: 'j1', stage: 'repairs_in_progress' } })
    expect(db.activity_log[0]).toMatchObject({ user_id: 'olivia', outcome: 'requested', approval_id: id, job_id: 'j1', summary: expect.stringMatching(/^Move IRC1001/) })
    await decideApproval({ tenantId: 't1', userId: 'kyle', id, decision: 'approve' })
    expect(db.activity_log[1]).toMatchObject({ user_id: 'olivia', via: 'approval', outcome: 'done', approved_by: 'kyle', approval_id: id, detail: 'Stage changed.' })
  })

  it('shows everyone’s to those who manage users, and only your own to others', async () => {
    await recordActivity({ tenantId: 't1', userId: 'kyle', action: 'send.work_orders', summary: 'Kyle sent', via: 'app', jobId: 'j1' })
    await recordActivity({ tenantId: 't1', userId: 'olivia', action: 'send.replies', summary: 'Olivia replied', via: 'voice' })
    await recordActivity({ tenantId: 't2', userId: 'other', action: 'send.replies', summary: 'elsewhere', via: 'app' })

    const admin = await listActivity('t1', 'kyle', {}, service as never)
    expect(admin.seesEveryone).toBe(true)
    expect(admin.entries.map(e => e.summary).sort()).toEqual(['Kyle sent', 'Olivia replied'])
    expect(admin.entries.find(e => e.summary === 'Kyle sent')).toMatchObject({ user: { name: 'Kyle' }, job: { number: 'IRC1001' } })

    const office = await listActivity('t1', 'olivia', { userId: 'kyle' }, service as never)
    expect(office.seesEveryone).toBe(false)
    expect(office.entries.map(e => e.summary)).toEqual(['Olivia replied'])

    const byVoice = await listActivityTool.run({ person: 'oliv' }, { supabase: service as never, tenantId: 't1', userId: 'kyle' })
    expect(byVoice.text).toMatch(/Olivia by voice: Olivia replied/)
    expect(byVoice.text).not.toMatch(/Kyle sent/)
  })
})

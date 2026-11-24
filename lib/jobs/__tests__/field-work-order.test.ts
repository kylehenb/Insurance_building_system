import { describe, it, expect, vi, beforeEach } from 'vitest'

// A builder's work order (PDF) → a Bindi Co job: the AI reads its details,
// the job is made (or reused when the same order is shared again) and the
// work order is kept in the job's files.

const tracked: Array<Record<string, unknown>> = []
const aiCalls: Array<{ messages: Array<{ content: Array<{ type: string }> }> }> = []
let aiReply = ''

vi.mock('@/lib/health/errors', () => ({ logError: async () => {} }))
vi.mock('@/lib/health/ai-usage', () => ({
  trackAi: async (meta: Record<string, unknown>, call: () => Promise<unknown>) => { tracked.push(meta); return call() },
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async (args: never) => { aiCalls.push(args); return { content: [{ type: 'text', text: aiReply }] } } }
  },
}))

const { parseWorkOrderReply, workOrderType, readWorkOrder, createJobFromWorkOrder } = await import('../field-work-order')

const PDF = { data: new TextEncoder().encode('%PDF-1.7 work order'), mimeType: 'application/pdf', fileName: 'WO 55123.pdf' }
const REPLY = JSON.stringify({
  reference: 'WO-55123', address: '12 Smith St, Kenwick WA 6107', insuredName: 'Jane Citizen', insuredPhone: '0400 111 222',
  insuredEmail: null, claimNumber: 'CLM998', dateOfLoss: '2026-11-02', description: 'Storm damage to roof tiles', instructions: 'Call before attending',
})

/** A Supabase stand-in: jobs looked up by job_number, inserts recorded */
function fakeService(existing: Record<string, unknown> | null = null) {
  const inserts: Record<string, Array<Record<string, unknown>>> = {}
  const uploads: string[] = []
  const insertInto = (table: string) => (row: Record<string, unknown>) => {
    ;(inserts[table] ??= []).push(row)
    const result = { data: { id: `${table}-1`, job_number: row.job_number }, error: null }
    return { select: () => ({ single: async () => result }), then: (ok: (v: unknown) => void) => ok({ error: null }) }
  }
  const service = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }) }),
      insert: insertInto(table),
    }),
    storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null } } }) },
  }
  return { service: service as never, inserts, uploads }
}

beforeEach(() => { tracked.length = 0; aiCalls.length = 0; aiReply = REPLY })

describe('reading a work order', () => {
  it('takes PDFs and pictures, by type or file name', () => {
    expect(workOrderType('application/pdf')).toBe('application/pdf')
    expect(workOrderType('application/octet-stream', 'Order.PDF')).toBe('application/pdf')
    expect(workOrderType('image/jpg')).toBe('image/jpeg')
    expect(workOrderType('text/html')).toBeNull()
  })

  it('reads the reply, leaving out what is missing or malformed', () => {
    expect(parseWorkOrderReply(`Here:\n${REPLY}`)).toMatchObject({ reference: 'WO-55123', insuredName: 'Jane Citizen', insuredEmail: null, dateOfLoss: '2026-11-02' })
    expect(parseWorkOrderReply('{"reference":"A","address":"B","dateOfLoss":"2/11/2026","insuredName":"null"}')).toMatchObject({ dateOfLoss: null, insuredName: null })
    expect(parseWorkOrderReply('no json')).toBeNull()
  })

  it('sends the PDF as a document, tracked as Midcity AI use', async () => {
    await readWorkOrder(PDF, 't1')
    expect(aiCalls[0].messages[0].content[0].type).toBe('document')
    expect(tracked[0]).toMatchObject({ feature: 'midcity-work-order', tenantId: 't1' })
  })

  it('refuses other files before any AI call, and says what it could not find', async () => {
    await expect(readWorkOrder({ data: new Uint8Array([1]), mimeType: 'text/plain' })).rejects.toMatchObject({ status: 400 })
    expect(aiCalls).toHaveLength(0)
    aiReply = '{"reference":"WO-1","address":null}'
    await expect(readWorkOrder(PDF)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('property address') })
  })
})

describe('createJobFromWorkOrder', () => {
  it('makes the Midcity job with the insured and claim details, and keeps the PDF', async () => {
    const { service, inserts, uploads } = fakeService()
    const job = await createJobFromWorkOrder(service, { tenantId: 't1', userId: 'u1', file: PDF })
    expect(job).toMatchObject({ jobId: 'jobs-1', inspectionId: 'inspections-1', jobNumber: 'WO-55123', existing: false })
    expect(inserts.jobs[0]).toMatchObject({
      tenant_id: 't1', insurer: 'Midcity', job_number: 'WO-55123', property_address: '12 Smith St, Kenwick WA 6107',
      insured_name: 'Jane Citizen', insured_phone: '0400 111 222', claim_number: 'CLM998', date_of_loss: '2026-11-02',
      special_instructions: 'Call before attending',
    })
    expect(inserts.inspections[0]).toMatchObject({ job_id: 'jobs-1', status: 'appointment_confirmed' })
    expect(uploads[0]).toMatch(/^tenants\/t1\/jobs\/jobs-1\/docs\/\d+-WO_55123\.pdf$/)
    expect(inserts.job_files[0]).toMatchObject({ file_kind: 'PDF', description: "Builder's work order", added_by: 'u1' })
  })

  it('opens the job already made when the same work order is shared again', async () => {
    const { service, inserts, uploads } = fakeService({ id: 'j9', job_number: 'WO-55123', insurer: 'Midcity', inspections: [{ id: 'i9' }] })
    expect(await createJobFromWorkOrder(service, { tenantId: 't1', userId: 'u1', file: PDF })).toMatchObject({ jobId: 'j9', inspectionId: 'i9', existing: true })
    expect(inserts).toEqual({})
    expect(uploads).toEqual([])
  })

  it("won't touch an IRC job that has the same reference", async () => {
    const { service } = fakeService({ id: 'j8', job_number: 'WO-55123', insurer: 'Suncorp', inspections: [] })
    await expect(createJobFromWorkOrder(service, { tenantId: 't1', userId: 'u1', file: PDF })).rejects.toMatchObject({ status: 409 })
  })
})

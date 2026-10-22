import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExcessContext } from '@/lib/excess/decision'

// Signing and excess tools: they use the Send for Signature dialog's defaults
// and functions, make Claude ask the excess question, and refuse a second
// request for a document that's still out for signature.

const jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '123 Test Street', insured_name: 'Smith' }]
function query() {
  const preds: ((r: Record<string, unknown>) => boolean)[] = []
  const apply = () => jobs.filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    ilike: (c: string, p: string) => { preds.push(r => String(r[c]).toLowerCase() === p.toLowerCase()); return b },
    limit: () => b,
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}

class SigningError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}
class ExcessError extends SigningError {}

const signing = {
  defaults: vi.fn(), list: vi.fn(), send: vi.fn(), resend: vi.fn(),
}
const excess = { load: vi.fn(), record: vi.fn() }
vi.mock('@/lib/signing/service', () => ({
  getSendDialogDefaults: (...a: unknown[]) => signing.defaults(...a),
  listSigningRequestsForJob: (...a: unknown[]) => signing.list(...a),
  sendForSignature: (...a: unknown[]) => signing.send(...a),
  resendSigningRequest: (...a: unknown[]) => signing.resend(...a),
}))
vi.mock('@/lib/signing/provider', () => ({ SigningError }))
vi.mock('@/lib/excess/server', () => ({
  ExcessError,
  loadExcessContext: (...a: unknown[]) => excess.load(...a),
  recordExcessDecision: (...a: unknown[]) => excess.record(...a),
}))

const { getSigning, sendForSignatureTool, resendSigningRequestTool } = await import('../tools/signing')
const { getJobExcess, setJobExcessDecision } = await import('../tools/excess')

const ctx = { supabase: { from: query } as never, tenantId: 't1', userId: 'u1' }
const actor = { tenantId: 't1', userId: 'u1' }
const Q1 = '11111111-1111-1111-1111-111111111111'
const REQ = '22222222-2222-2222-2222-222222222222'

const excessCtx = (over: Partial<ExcessContext> = {}): ExcessContext => ({
  applies: true, amount: 500, decision: null, note: null, decidedAt: null, decidedByName: null, invoices: [], ...over,
})
const request = (over: Record<string, unknown> = {}) => ({
  id: REQ, jobId: 'j1', documentType: 'scope_of_works', documentTitle: 'Scope of Works Authorisation', status: 'sent',
  signerName: 'Jane Smith', signerEmail: 'jane@example.com', signerPhone: null, expiresAt: '2026-11-05T00:00:00Z',
  sentAt: '2026-10-20T02:00:00Z', viewedAt: null, signedAt: null, revokedAt: null, revokedReason: null,
  reminderCount: 0, lastRemindedAt: null, remindersEnabled: true, quoteIds: [Q1], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  signing.defaults.mockResolvedValue({
    jobStage: 'approved_awaiting_signoff', propertyAddress: '123 Test Street',
    quotes: [{ id: Q1, ref: 'Q-IRC1001-7', status: 'approved', totalInclGst: 6450, signable: true }],
    suggestedQuoteIds: [Q1], suggestedDocumentType: 'scope_of_works', suggestedTotalInclGst: 6450,
    signer: { name: 'Jane Smith', email: 'jane@example.com', phone: '' }, signerSource: 'insured',
    excess: excessCtx(),
  })
  signing.list.mockResolvedValue([])
  signing.send.mockResolvedValue({ request: request(), stageMoved: true, excessInvoiceRef: 'INV-IRC1001-2' })
  signing.resend.mockResolvedValue(request({ reminderCount: 0 }))
  excess.load.mockResolvedValue(excessCtx())
})

describe('get_signing', () => {
  it('reads back the requests, the suggested send and the excess question', async () => {
    signing.list.mockResolvedValue([request({ status: 'signed', signedAt: '2026-10-21T02:00:00Z', documentType: 'building_contract', documentTitle: 'Building Contract' })])
    const res = await getSigning.run({ job_number: 'IRC1001' }, ctx)
    expect(res.text).toMatch(/- Building Contract to Jane Smith \(jane@example\.com\): signed Wed,? 21 Oct\./)
    expect(res.text).toContain('A new request would send the Scope of Works Authorisation for Q-IRC1001-7 ($6,450), total $6,450.')
    expect(res.text).toContain('Signer: Jane Smith, jane@example.com (the insured).')
    expect(res.text).toContain('Sending moves the job to Awaiting Signed Document.')
    expect(res.text).toContain('create an excess invoice for $500 and attach it')
  })
})

describe('send_for_signature', () => {
  it('asks the excess question instead of sending without an excess choice', async () => {
    const res = await sendForSignatureTool.run({ job_number: 'IRC1001' }, ctx)
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/^Excess: Excess \$500 on file — no decision recorded yet\..* Before sending, ask which/)
    expect(signing.send).not.toHaveBeenCalled()
  })

  it('sends with the dialog’s defaults and the chosen excess', async () => {
    const res = await sendForSignatureTool.run({ job_number: 'irc1001', excess: { kind: 'new_invoice', amountIncGst: 500 } }, ctx)
    expect(signing.send).toHaveBeenCalledWith(
      actor,
      { jobId: 'j1', documentType: 'scope_of_works', quoteIds: [Q1], signer: { name: 'Jane Smith', email: 'jane@example.com', phone: null }, remindersEnabled: true },
      { moveJobToAwaitingStage: true, excess: { kind: 'new_invoice', amountIncGst: 500 } },
    )
    expect(res.text).toBe('Scope of Works Authorisation and excess invoice INV-IRC1001-2 emailed to jane@example.com for IRC1001. Job moved to Awaiting Signed Document.')
  })

  it('uses the signer and document the user gave, and leaves the stage alone elsewhere', async () => {
    signing.defaults.mockResolvedValue({ ...(await signing.defaults()), jobStage: 'works_in_progress', excess: excessCtx({ applies: false }) })
    await sendForSignatureTool.run({ job_number: 'IRC1001', document_type: 'building_contract', signer_name: 'Kyle', signer_email: 'kyle@example.com' }, ctx)
    expect(signing.send).toHaveBeenCalledWith(actor,
      expect.objectContaining({ documentType: 'building_contract', signer: { name: 'Kyle', email: 'kyle@example.com', phone: null } }),
      { moveJobToAwaitingStage: false, excess: null })
  })

  it('refuses a second request while the same document is out, unless confirmed', async () => {
    signing.list.mockResolvedValue([request({ status: 'viewed', viewedAt: '2026-10-21T02:00:00Z' })])
    const res = await sendForSignatureTool.run({ job_number: 'IRC1001', excess: { kind: 'no_excess' } }, ctx)
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/^Not sent: Scope of Works Authorisation to Jane Smith .* opened .*\(resend_signing_request\)/)
    expect(signing.send).not.toHaveBeenCalled()

    await sendForSignatureTool.run({ job_number: 'IRC1001', excess: { kind: 'no_excess' }, send_anyway: true }, ctx)
    expect(signing.send).toHaveBeenCalledTimes(1)
  })

  it('asks for a usable signer email, and passes on the app’s refusal', async () => {
    const bad = await sendForSignatureTool.run({ job_number: 'IRC1001', signer_email: 'not-an-email', excess: { kind: 'no_excess' } }, ctx)
    expect(bad).toMatchObject({ isError: true, text: expect.stringContaining('"not-an-email" isn\'t valid') })

    signing.send.mockRejectedValueOnce(new SigningError('The email failed. Nothing was sent — please try again.', 502))
    const res = await sendForSignatureTool.run({ job_number: 'IRC1001', excess: { kind: 'no_excess' } }, ctx)
    expect(res).toMatchObject({ isError: true, text: 'The email failed. Nothing was sent — please try again.' })
  })
})

describe('resend_signing_request', () => {
  it('sends a fresh link for the request', async () => {
    const res = await resendSigningRequestTool.run({ request_id: REQ }, ctx)
    expect(signing.resend).toHaveBeenCalledWith(actor, REQ)
    expect(res.text).toMatch(/^Sent Jane Smith a fresh link for the Scope of Works Authorisation\./)
  })
})

describe('excess', () => {
  it('describes the amount, the decision and any excess invoices', async () => {
    excess.load.mockResolvedValue(excessCtx({
      decision: 'collect', decidedAt: '2026-10-20T02:00:00Z', decidedByName: 'Kyle',
      invoices: [{ id: 'i1', ref: 'INV-IRC1001-1', amountIncGst: 500, status: 'sent', issuedDate: '2026-10-20', paidDate: null }],
    }))
    const res = await getJobExcess.run({ job_number: 'IRC1001' }, ctx)
    expect(res.text).toMatch(/^IRC1001, 123 Test Street: Excess \$500 on file — Collecting excess, decided .* by Kyle\. Excess invoice INV-IRC1001-1 \(\$500\.00\) sent .* check it’s been paid/)
  })

  it('records a waiver for the signed-in connector user', async () => {
    excess.load.mockResolvedValueOnce(excessCtx()).mockResolvedValueOnce(excessCtx({ decision: 'cash_settlement', note: 'Insurer deducted it' }))
    const res = await setJobExcessDecision.run({ job_number: 'IRC1001', decision: 'cash_settlement', note: 'Insurer deducted it' }, ctx)
    expect(excess.record).toHaveBeenCalledWith(ctx.supabase, { tenantId: 't1', jobId: 'j1', userId: 'u1', decision: 'cash_settlement', note: 'Insurer deducted it' })
    expect(res.text).toBe('Recorded for IRC1001: Excess $500 on file — Not collected — cash settled (Insurer deducted it).')
  })

  it('refuses "collect", and jobs without an excess', async () => {
    expect((await setJobExcessDecision.run({ job_number: 'IRC1001', decision: 'collect' }, ctx)).isError).toBe(true)
    excess.load.mockResolvedValue(excessCtx({ applies: false }))
    expect((await setJobExcessDecision.run({ job_number: 'IRC1001', decision: 'nil' }, ctx)).isError).toBe(true)
    expect(excess.record).not.toHaveBeenCalled()
  })
})

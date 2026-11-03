import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { computePhase, describePhase, legacyStage, recomputePhase, recomputeStalePhases, type PhaseContext } from '../phase'

// Job phases: assessment → awaiting decision → in repair → invoicing →
// closed, with the next step inside each, worked out from the job's records.
// A job closes only once everything on it is paid.

const job = (o: Partial<PhaseContext['job']> = {}): PhaseContext['job'] => ({
  override_stage: null, homeowner_signoff_sent_at: null, homeowner_signoff_received_at: null, completion_approved_at: null, lapsed_at: null, closed_by_hand: null, ...o,
})
const ctx = (o: Partial<PhaseContext> = {}): PhaseContext => ({ job: job(), quotes: [], reports: [], inspections: [], visits: [], invoices: [], hasAppointment: false, ...o })
const inv = (invoice_type: string, status: string) => ({ direction: 'outbound', invoice_type, status })

describe('working out the phase', () => {
  it('walks an assessment from booking to submitting', () => {
    expect(computePhase(ctx())).toEqual({ phase: 'assessment', step: 'book_inspection', closedReason: null })
    expect(computePhase(ctx({ hasAppointment: true }))).toMatchObject({ phase: 'assessment', step: 'attend' })
    expect(computePhase(ctx({ inspections: [{ status: 'submitted', form_submitted_at: '2026-10-31' }], reports: [{ report_type: 'BAR', status: 'draft' }] }))).toMatchObject({ step: 'write_report' })
    expect(computePhase(ctx({ inspections: [{ status: 'submitted', form_submitted_at: 'x' }], quotes: [{ status: 'ready' }] }))).toMatchObject({ step: 'submit' })
  })

  it('waits on the insurer once quoted, closes as no decision once lapsed, and reopens on a late approval', () => {
    expect(computePhase(ctx({ quotes: [{ status: 'sent' }] }))).toMatchObject({ phase: 'awaiting_decision', step: 'waiting_on_insurer' })
    expect(computePhase(ctx({ quotes: [{ status: 'sent' }], job: job({ lapsed_at: 'x' }) }))).toEqual({ phase: 'closed', step: null, closedReason: 'no_decision' })
    expect(computePhase(ctx({ quotes: [{ status: 'approved' }], job: job({ lapsed_at: 'x' }) }))).toMatchObject({ phase: 'in_repair' })
    expect(computePhase(ctx({ quotes: [{ status: 'approved' }], job: job({ closed_by_hand: 'no_decision' }) }))).toMatchObject({ phase: 'in_repair' })
  })

  it('takes a repair from signing to sign-off', () => {
    const approved = { quotes: [{ status: 'approved' }] }
    expect(computePhase(ctx(approved))).toMatchObject({ phase: 'in_repair', step: 'get_signed' })
    expect(computePhase(ctx({ ...approved, job: job({ homeowner_signoff_sent_at: 'x' }) }))).toMatchObject({ step: 'awaiting_signature' })
    expect(computePhase(ctx({ ...approved, job: job({ homeowner_signoff_received_at: 'x' }), visits: [{ status: 'unscheduled' }] }))).toMatchObject({ step: 'book_trades' })
    // Small jobs without signing: works started counts
    expect(computePhase(ctx({ ...approved, visits: [{ status: 'scheduled' }, { status: 'unscheduled' }] }))).toMatchObject({ step: 'works_underway' })
    expect(computePhase(ctx({ ...approved, visits: [{ status: 'complete' }] }))).toMatchObject({ step: 'record_signoff' })
  })

  it('invoices once the works are done, and closes when everything is paid', () => {
    const done = { quotes: [{ status: 'approved' }], job: job({ completion_approved_at: 'x' }) }
    expect(computePhase(ctx({ ...done, invoices: [{ direction: 'inbound', invoice_type: 'standard', status: 'pending' }] }))).toMatchObject({ phase: 'invoicing', step: 'trade_invoices' })
    expect(computePhase(ctx(done))).toMatchObject({ phase: 'invoicing', step: 'invoice_insurer' })
    expect(computePhase(ctx({ ...done, invoices: [inv('assessment', 'paid'), inv('quoted_amounts', 'sent')] }))).toMatchObject({ step: 'awaiting_payment' })
    // The excess is owed too
    expect(computePhase(ctx({ ...done, invoices: [inv('quoted_amounts', 'paid'), inv('excess', 'sent')] }))).toMatchObject({ phase: 'invoicing', step: 'awaiting_payment' })
    expect(computePhase(ctx({ ...done, invoices: [inv('quoted_amounts', 'paid'), inv('excess', 'paid'), inv('assessment', 'voided')] }))).toEqual({ phase: 'closed', step: null, closedReason: 'complete' })
  })

  it('closes a declined claim once its report fee is paid', () => {
    expect(computePhase(ctx({ quotes: [{ status: 'rejected' }], invoices: [inv('assessment', 'sent')] }))).toMatchObject({ phase: 'invoicing', step: 'awaiting_payment' })
    expect(computePhase(ctx({ quotes: [{ status: 'rejected' }], invoices: [inv('assessment', 'paid')] }))).toEqual({ phase: 'closed', step: null, closedReason: 'declined' })
  })

  it('takes a report-only job straight to invoicing, and closes it when paid', () => {
    const sent = { reports: [{ report_type: 'make_safe', status: 'sent' }] }
    expect(computePhase(ctx(sent))).toMatchObject({ phase: 'invoicing', step: 'invoice_fee' })
    expect(computePhase(ctx({ ...sent, invoices: [inv('make_safe', 'sent')] }))).toMatchObject({ step: 'awaiting_payment' })
    expect(computePhase(ctx({ ...sent, invoices: [inv('make_safe', 'paid')] }))).toMatchObject({ phase: 'closed', closedReason: 'complete' })
  })

  it('closes a cancelled job, and one closed by hand', () => {
    expect(computePhase(ctx({ job: job({ override_stage: 'cancelled' }), quotes: [{ status: 'approved' }] }))).toEqual({ phase: 'closed', step: null, closedReason: 'cancelled' })
    expect(computePhase(ctx({ job: job({ closed_by_hand: 'complete' }) }))).toMatchObject({ phase: 'closed', closedReason: 'complete' })
  })

  it('says it in words, and keeps the old stage key in step', () => {
    expect(describePhase({ phase: 'in_repair', phase_step: 'book_trades', closed_reason: null })).toBe('In repair · Book the trades')
    expect(describePhase({ phase: 'closed', phase_step: null, closed_reason: 'no_decision', override_stage: null })).toBe('Closed · No decision')
    expect(describePhase({ phase: 'awaiting_decision', phase_step: 'waiting_on_insurer', closed_reason: null, override_stage: 'on_hold' })).toBe('On hold — Awaiting decision · Waiting on the insurer')
    expect(legacyStage({ phase: 'awaiting_decision', step: 'waiting_on_insurer', closedReason: null })).toBe('sent_awaiting_approval')
    expect(legacyStage({ phase: 'closed', step: null, closedReason: 'no_decision' })).toBe('complete')
    expect(legacyStage({ phase: 'in_repair', step: 'get_signed', closedReason: null }, 'on_hold')).toBe('on_hold')
  })
})

describe('saving the phase', () => {
  const tables: Record<string, Row[]> = {}
  const db = fakeSupabase(tables) as never
  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k]
    tables.jobs = [{ id: 'j1', tenant_id: 't1', phase: null, phase_since: null, phase_stale: true, current_stage: 'awaiting_schedule', created_at: '2026-04-01T00:00:00Z', override_stage: null, lapsed_at: null, closed_by_hand: null }]
    tables.quotes = [{ job_id: 'j1', is_active_version: true, status: 'sent', created_at: '2026-04-10T00:00:00Z' }]
  })

  it('works out flagged jobs, starting a long wait\'s clock when its quote went, and keeps the old stage in step', async () => {
    expect(await recomputeStalePhases(db)).toBe(1)
    expect(tables.jobs[0]).toMatchObject({ phase: 'awaiting_decision', phase_step: 'waiting_on_insurer', phase_since: '2026-04-10T00:00:00Z', phase_stale: false, current_stage: 'sent_awaiting_approval' })
    // Moving on later starts the new phase's clock now
    tables.quotes[0].status = 'approved'
    const at = new Date('2026-11-02T00:00:00Z')
    await recomputePhase(db, 'j1', at)
    expect(tables.jobs[0]).toMatchObject({ phase: 'in_repair', phase_since: at.toISOString(), current_stage: 'approved_awaiting_signoff' })
  })

  it('puts each change in the job\'s ledger, but not the first time it\'s worked out or when nothing moved', async () => {
    await recomputeStalePhases(db)
    expect(tables.activity_log ?? []).toHaveLength(0)
    await recomputePhase(db, 'j1')
    expect(tables.activity_log ?? []).toHaveLength(0)
    tables.quotes[0].status = 'approved'
    await recomputePhase(db, 'j1')
    expect(tables.activity_log).toEqual([expect.objectContaining({
      tenant_id: 't1', job_id: 'j1', user_id: null, via: 'system', action: 'job.phase',
      summary: expect.stringMatching(/^Moved to In repair · .+ \(was Awaiting decision\)$/),
    })])
  })
})

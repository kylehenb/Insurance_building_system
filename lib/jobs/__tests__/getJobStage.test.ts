import { describe, it, expect } from 'vitest'
import { getJobStage } from '../getJobStage'
import type { JobContext } from '../getJobStage'

function buildContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    job: {
      id: 'job-1',
      override_stage: null,
      current_stage: null,
      current_stage_updated_at: null,
      homeowner_signoff_sent_at: null,
      homeowner_signoff_received_at: null,
      completion_approved_at: null,
    },
    insurer_orders: [],
    inspections: [],
    primary_quote: null,
    reports: [],
    work_order_visits: [],
    trade_invoices: [],
    outbound_invoices: [],
    open_loops: [],
    ...overrides,
  }
}

describe('getJobStage', () => {
  it('order received, no job linked yet', () => {
    const ctx = buildContext({
      insurer_orders: [{ status: 'pending' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('order_received')
    expect(stage.primaryAction?.actionKey).toBe('review_lodge')
  })

  it('job active, no inspection exists', () => {
    const ctx = buildContext({ inspections: [] })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('awaiting_schedule')
  })

  it('awaiting schedule with prior no-show', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'unscheduled',
        form_submitted_at: null,
        no_show_count: 1,
        last_no_show_at: '2025-01-01',
      }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('awaiting_schedule')
    expect(stage.contextualWarning).toBeDefined()
    expect(stage.contextualWarning?.severity).toBe('warning')
  })

  it('inspection confirmed', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'confirmed',
        form_submitted_at: null,
        no_show_count: 0,
        last_no_show_at: null,
      }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('inspection_scheduled')
    expect(stage.primaryAction).toBeNull()
    expect(stage.isWaiting).toBe(true)
  })

  it('inspection submitted, quote still draft', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'draft' },
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('awaiting_compilation')
    expect(stage.primaryAction?.actionKey).toBe('compile_send')
  })

  it('quote and report both sent', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'sent' },
      reports: [{ id: 'report-1', report_type: 'BAR', status: 'sent', version: 1 }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('sent_awaiting_approval')
    expect(stage.primaryAction).toBeNull()
    expect(stage.isWaiting).toBe(true)
  })

  it('quote rejected', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'rejected' },
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('declined_close_out')
    expect(stage.isBranch).toBe(true)
    expect(stage.primaryAction?.actionKey).toBe('close_out')
  })

  it('quote approved, signoff not yet sent', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: null,
        homeowner_signoff_received_at: null,
        completion_approved_at: null,
      },
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('approved_awaiting_signoff')
    expect(stage.primaryAction?.actionKey).toBe('send_for_signature')
  })

  it('signoff sent, not yet received', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: null,
        completion_approved_at: null,
      },
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('awaiting_signed_document')
    expect(stage.primaryAction).toBeNull()
    expect(stage.isWaiting).toBe(true)
  })

  it('signoff received, no work order visits yet', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: null,
      },
      work_order_visits: [],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('signed_build_schedule')
    expect(stage.primaryAction?.actionKey).toBe('build_schedule')
  })

  it('signoff received, all visits still unscheduled', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: null,
      },
      work_order_visits: [{ status: 'unscheduled' }, { status: 'unscheduled' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('signed_build_schedule')
    expect(stage.primaryAction?.actionKey).toBe('build_schedule')
  })

  it('signoff received, visits in progress', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: null,
      },
      work_order_visits: [{ status: 'confirmed' }, { status: 'complete' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('repairs_in_progress')
    expect(stage.primaryAction).toBeNull()
    expect(stage.isWaiting).toBe(true)
  })

  it('partially approved quote triggers approved_awaiting_signoff', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'partially_approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: null,
        homeowner_signoff_received_at: null,
        completion_approved_at: null,
      },
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('approved_awaiting_signoff')
    expect(stage.primaryAction?.actionKey).toBe('send_for_signature')
  })

  it('all visits complete, no completion approval', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: null,
      },
      work_order_visits: [{ status: 'complete' }, { status: 'complete' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('awaiting_completion_signoff')
    expect(stage.primaryAction?.actionKey).toBe('record_signoff')
  })

  it('completion approved, trade invoices pending', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: '2025-07-01T10:00:00Z',
      },
      work_order_visits: [{ status: 'complete' }],
      trade_invoices: [{ status: 'received' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('awaiting_trade_invoices')
    expect(stage.primaryAction?.actionKey).toBe('review_trade_invoices')
  })

  it('all trade invoices approved, no outbound invoice', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: '2025-07-01T10:00:00Z',
      },
      work_order_visits: [{ status: 'complete' }],
      trade_invoices: [{ status: 'approved' }, { status: 'approved' }],
      outbound_invoices: [],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('ready_to_invoice')
    expect(stage.primaryAction?.actionKey).toBe('create_invoice')
  })

  it('outbound invoice sent, not paid', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: '2025-07-01T10:00:00Z',
      },
      work_order_visits: [{ status: 'complete' }],
      trade_invoices: [{ status: 'approved' }],
      outbound_invoices: [{ status: 'sent' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('invoiced_awaiting_payment')
    expect(stage.primaryAction).toBeNull()
    expect(stage.isWaiting).toBe(true)
  })

  it('invoice paid', () => {
    const ctx = buildContext({
      inspections: [{
        id: 'insp-1',
        status: 'complete',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      job: {
        id: 'job-1',
        override_stage: null,
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: '2025-07-01T10:00:00Z',
      },
      work_order_visits: [{ status: 'complete' }],
      trade_invoices: [{ status: 'approved' }],
      outbound_invoices: [{ status: 'paid' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('complete')
    expect(stage.isBranch).toBe(true)
    expect(stage.primaryAction).toBeNull()
  })

  it('job on hold overrides everything', () => {
    const ctx = buildContext({
      job: {
        id: 'job-1',
        override_stage: 'on_hold',
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: '2025-07-01T10:00:00Z',
      },
      insurer_orders: [{ status: 'pending' }],
      inspections: [{
        id: 'insp-1',
        status: 'confirmed',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      work_order_visits: [{ status: 'complete' }],
      trade_invoices: [{ status: 'approved' }],
      outbound_invoices: [{ status: 'sent' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('on_hold')
    expect(stage.primaryAction).toBeNull()
  })

  it('job cancelled overrides everything', () => {
    const ctx = buildContext({
      job: {
        id: 'job-1',
        override_stage: 'cancelled',
        current_stage: null,
        current_stage_updated_at: null,
        homeowner_signoff_sent_at: '2025-06-10T10:00:00Z',
        homeowner_signoff_received_at: '2025-06-12T10:00:00Z',
        completion_approved_at: '2025-07-01T10:00:00Z',
      },
      insurer_orders: [{ status: 'pending' }],
      inspections: [{
        id: 'insp-1',
        status: 'confirmed',
        form_submitted_at: '2025-06-01T10:00:00Z',
        no_show_count: 0,
        last_no_show_at: null,
      }],
      primary_quote: { status: 'approved' },
      work_order_visits: [{ status: 'complete' }],
      trade_invoices: [{ status: 'approved' }],
      outbound_invoices: [{ status: 'paid' }],
    })
    const stage = getJobStage(ctx)
    expect(stage.key).toBe('cancelled')
    expect(stage.primaryAction).toBeNull()
  })
})

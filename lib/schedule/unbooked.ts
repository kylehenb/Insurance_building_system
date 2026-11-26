import type { SupabaseClient } from '@supabase/supabase-js'
import { woIsSent } from '@/app/dashboard/jobs/[jobId]/work-orders/types'
import { isFieldAppJob } from '@/lib/jobs/field-app'

// Not booked yet (tech spec §23.18): the other half of the schedule — what
// still needs a date. It goes by the job's phase (lib/jobs/phase.ts), which
// already knows when a job is at "book the inspection" or in repair:
//   - inspections: jobs at assessment · book_inspection, with the insurer's
//     booking deadline (kpi_booking_due) when there is one;
//   - trades: on jobs in repair, each work order's visits with no date (a
//     work order with no visit yet counts as its first). Jobs still waiting on
//     the homeowner's signature are listed apart — trades can't start yet.
// Whose is the person looking after the job (jobs.assigned_to); a job nobody's
// been given counts as the asker's own. On-hold jobs and Midcity's stay out.

export type UnbookedInspection = {
  job_id: string
  job_number: string
  address: string | null
  insured_name: string | null
  /** The insurer's deadline to book (ISO), if the job has one */
  booking_due: string | null
  overdue: boolean
  owner_id: string | null
  owner_name: string | null
}

export type UnbookedTrade = {
  work_order_id: string
  trade: string
  business: string | null
  /** The visits with no date, e.g. [1, 2] */
  visits: number[]
  total_visits: number
  sent: boolean
}

export type UnbookedTradeJob = {
  job_id: string
  job_number: string
  address: string | null
  /** Signed and ready for trades (book_trades / works_underway); false: still waiting on the homeowner's signature */
  ready: boolean
  step: string | null
  owner_id: string | null
  owner_name: string | null
  trades: UnbookedTrade[]
}

export type Unbooked = { inspections: UnbookedInspection[]; trade_jobs: UnbookedTradeJob[] }

const READY_STEPS = new Set(['book_trades', 'works_underway'])

type JobRow = {
  id: string; job_number: string; property_address: string | null; insured_name: string | null; insurer: string | null
  assigned_to: string | null; phase: string | null; phase_step: string | null; phase_since: string | null
  kpi_booking_due: string | null; override_stage: string | null
}

export async function loadUnbooked(db: SupabaseClient, tenantId: string, opts: { personId?: string; includeUnassigned?: boolean; now?: Date } = {}): Promise<Unbooked> {
  const now = opts.now ?? new Date()
  const [{ data: jobRows }, { data: userRows }] = await Promise.all([
    db.from('jobs').select('id, job_number, property_address, insured_name, insurer, assigned_to, phase, phase_step, phase_since, kpi_booking_due, override_stage')
      .eq('tenant_id', tenantId).in('phase', ['assessment', 'in_repair']),
    db.from('users').select('id, name').eq('tenant_id', tenantId),
  ])
  const names = new Map(((userRows as { id: string; name: string | null }[] | null) ?? []).map(u => [u.id, u.name]))
  const jobs = ((jobRows as JobRow[] | null) ?? [])
    .filter(j => !isFieldAppJob(j) && j.override_stage !== 'on_hold')
    .filter(j => !opts.personId || j.assigned_to === opts.personId || (!j.assigned_to && opts.includeUnassigned))
  const owner = (j: JobRow) => ({ owner_id: j.assigned_to, owner_name: j.assigned_to ? names.get(j.assigned_to) ?? null : null })

  const inspections: UnbookedInspection[] = jobs
    .filter(j => j.phase === 'assessment' && j.phase_step === 'book_inspection')
    .map(j => ({
      job_id: j.id, job_number: j.job_number, address: j.property_address, insured_name: j.insured_name,
      booking_due: j.kpi_booking_due, overdue: !!j.kpi_booking_due && new Date(j.kpi_booking_due) < now, ...owner(j),
    }))
    .sort((a, b) => (a.booking_due ?? '9999').localeCompare(b.booking_due ?? '9999') || a.job_number.localeCompare(b.job_number))

  const repairJobs = jobs.filter(j => j.phase === 'in_repair')
  const trade_jobs: UnbookedTradeJob[] = []
  if (repairJobs.length) {
    const ids = repairJobs.map(j => j.id)
    const [{ data: woRows }, { data: visitRows }] = await Promise.all([
      db.from('work_orders').select('id, job_id, trade_name, trade_id, total_visits, gary_state, status').eq('tenant_id', tenantId).in('job_id', ids),
      db.from('work_order_visits').select('work_order_id, visit_number, status, scheduled_date').eq('tenant_id', tenantId).in('job_id', ids),
    ])
    type Wo = { id: string; job_id: string; trade_name: string | null; trade_id: string | null; total_visits: number | null; gary_state: string | null; status: string | null }
    type Visit = { work_order_id: string; visit_number: number; status: string | null; scheduled_date: string | null }
    const workOrders = ((woRows as Wo[] | null) ?? []).filter(w => w.status !== 'cancelled')
    const visits = (visitRows as Visit[] | null) ?? []
    const tradeIds = [...new Set(workOrders.map(w => w.trade_id).filter((v): v is string => !!v))]
    const { data: tradeRows } = tradeIds.length ? await db.from('trades').select('id, business_name').eq('tenant_id', tenantId).in('id', tradeIds) : { data: [] }
    const business = new Map(((tradeRows as { id: string; business_name: string | null }[] | null) ?? []).map(t => [t.id, t.business_name]))

    for (const j of repairJobs) {
      const trades: UnbookedTrade[] = []
      for (const w of workOrders.filter(x => x.job_id === j.id)) {
        const own = visits.filter(v => v.work_order_id === w.id)
        if (own.length && own.every(v => v.status === 'complete')) continue
        const open = own.length ? own.filter(v => !v.scheduled_date && v.status !== 'complete').map(v => v.visit_number).sort((a, b) => a - b) : [1]
        if (!open.length) continue
        trades.push({
          work_order_id: w.id, trade: w.trade_name ?? 'Trade', business: w.trade_id ? business.get(w.trade_id) ?? null : null,
          visits: open, total_visits: Math.max(own.length, w.total_visits ?? 1), sent: woIsSent(w),
        })
      }
      if (trades.length) {
        trade_jobs.push({ job_id: j.id, job_number: j.job_number, address: j.property_address, ready: READY_STEPS.has(j.phase_step ?? ''), step: j.phase_step, ...owner(j), trades })
      }
    }
    // Ready first, the longest waiting first
    const since = new Map(repairJobs.map(j => [j.id, j.phase_since ?? '']))
    trade_jobs.sort((a, b) => Number(b.ready) - Number(a.ready) || (since.get(a.job_id) ?? '').localeCompare(since.get(b.job_id) ?? '') || a.job_number.localeCompare(b.job_number))
  }

  return { inspections, trade_jobs }
}

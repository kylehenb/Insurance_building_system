import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// The Calendar page's booking routes: the session's tenant, permission
// jobs.edit, the shared booking functions (the voice tools' code), logged.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
let me: { tenantId: string; userId: string } | null = { tenantId: 't1', userId: 'u1' }
let denied: Response | null = null
const recorded: Row[] = []
const booked = vi.fn()

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me, unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => denied }))
vi.mock('@/lib/activity/log', () => ({ recordActivity: async (p: Row) => { recorded.push(p) } }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/communications/notes', () => ({ addJobNote: vi.fn(async () => ({})) }))
vi.mock('@/lib/inspections/booking', () => ({
  InspectionBookingError: class extends Error {},
  bookInspection: async (_db: unknown, p: Row) => { booked(p); return { job_number: 'IRC1079', moved: false } },
}))

const tradeVisit = (await import('../trade-visit/route')).POST
const inspection = (await import('../inspection/route')).POST
const post = (fn: typeof tradeVisit, body: unknown) => fn(new Request('https://app.test/api/x', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  me = { tenantId: 't1', userId: 'u1' }
  denied = null
  recorded.length = 0
  booked.mockClear()
  for (const k of Object.keys(tables)) delete tables[k]
  tables.work_orders = [{ id: 'wp', tenant_id: 't1', job_id: 'j79', trade_name: 'Painter', total_visits: 1, jobs: { job_number: 'IRC1079' } }]
  tables.work_order_visits = []
})

describe('POST /api/schedule/trade-visit', () => {
  it('books the trade\'s days and logs it', async () => {
    const res = await post(tradeVisit, { work_order_id: 'wp', start_date: '2026-12-01', end_date: '2026-12-03', start_time: '07:00' })
    expect(res.status).toBe(200)
    expect(tables.work_order_visits[0]).toMatchObject({ scheduled_date: '2026-12-01', scheduled_end_date: '2026-12-03', start_time: '07:00', status: 'confirmed' })
    expect(recorded).toEqual([expect.objectContaining({ action: 'jobs.edit', jobId: 'j79', via: 'app', summary: 'Booked the Painter on IRC1079 for Tue 1 Dec to Thu 3 Dec at 07:00' })])
  })

  it('takes it off again', async () => {
    await post(tradeVisit, { work_order_id: 'wp', start_date: '2026-12-01' })
    const res = await post(tradeVisit, { work_order_id: 'wp', clear: true })
    expect(res.status).toBe(200)
    expect(tables.work_order_visits[0]).toMatchObject({ scheduled_date: null, status: 'unscheduled' })
    expect(recorded.at(-1)).toMatchObject({ summary: 'Took the Painter off the schedule on IRC1079' })
  })

  it('refuses no firm day, no permission, another company\'s work order and no session', async () => {
    expect((await post(tradeVisit, { work_order_id: 'wp', start_date: 'next week' })).status).toBe(400)
    denied = new Response('{}', { status: 403 })
    expect((await post(tradeVisit, { work_order_id: 'wp', start_date: '2026-12-01' })).status).toBe(403)
    denied = null
    me = { tenantId: 't2', userId: 'u1' }
    expect((await post(tradeVisit, { work_order_id: 'wp', start_date: '2026-12-01' })).status).toBe(404)
    me = null
    expect((await post(tradeVisit, { work_order_id: 'wp', start_date: '2026-12-01' })).status).toBe(401)
    expect(tables.work_order_visits).toHaveLength(0)
    expect(recorded).toHaveLength(0)
  })
})

describe('POST /api/schedule/inspection', () => {
  it('books through bookInspection at the Perth time, for the session\'s tenant, and logs it', async () => {
    const res = await post(inspection, { job_id: 'j79', start: '2026-12-03T08:00', minutes: 90, inspection_id: 'i1' })
    expect(res.status).toBe(200)
    expect(booked).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', jobId: 'j79', start: '2026-12-03T00:00:00.000Z', minutes: 90, inspectionId: 'i1' }))
    expect(recorded).toEqual([expect.objectContaining({ action: 'jobs.edit', jobId: 'j79', summary: expect.stringMatching(/^Booked the inspection on IRC1079 for Thu 3 Dec, 8:00 am/) })])
  })

  it('needs a job and a time, and the permission', async () => {
    expect((await post(inspection, { job_id: 'j79' })).status).toBe(400)
    denied = new Response('{}', { status: 403 })
    expect((await post(inspection, { job_id: 'j79', start: '2026-12-03T08:00' })).status).toBe(403)
    expect(booked).not.toHaveBeenCalled()
  })
})

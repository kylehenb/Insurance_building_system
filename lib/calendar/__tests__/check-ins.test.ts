import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { checkInDue, queueAppointmentCheckIns } from '../check-ins'

// The check-in after a job appointment: queued two hours after it ends (or
// the next working morning), once per appointment, only for job appointments.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k] })

describe('when an appointment is checked', () => {
  it('is two hours after it ends inside office hours, else the next working morning', () => {
    expect(checkInDue('2026-11-03T02:00:00Z')).toBe('2026-11-03T04:00:00.000Z') // Tue 10am → noon
    expect(checkInDue('2026-11-03T08:00:00Z')).toBe('2026-11-04T00:00:00.000Z') // Tue 4pm → Wed 8am
    expect(checkInDue('2026-10-31T06:00:00Z')).toBe('2026-11-02T00:00:00.000Z') // Sat 2pm → Mon 8am
    expect(checkInDue('2026-11-02T20:00:00Z')).toBe('2026-11-03T00:00:00.000Z') // Tue 4am → 8am
  })
})

describe('queueing check-ins', () => {
  it('queues one per ended job appointment that\'s due, never for personal events or twice', async () => {
    const at = new Date('2026-11-02T04:00:00Z') // Mon noon
    tables.calendar_events = [
      { id: 'e1', tenant_id: 't1', job_id: 'j79', status: 'confirmed', summary: 'Belmont job (new order)', start_at: '2026-10-31T05:00:00Z', end_at: '2026-10-31T06:00:00Z' },
      { id: 'e2', tenant_id: 't1', job_id: null, status: 'confirmed', summary: 'Gym', start_at: '2026-11-01T22:00:00Z', end_at: '2026-11-01T23:00:00Z' },
      { id: 'e3', tenant_id: 't1', job_id: 'j78', status: 'confirmed', summary: 'Site meeting', start_at: '2026-11-02T02:30:00Z', end_at: '2026-11-02T03:00:00Z' }, // ended an hour ago
      { id: 'e4', tenant_id: 't1', job_id: 'j77', status: 'cancelled', summary: 'Cancelled', start_at: '2026-10-31T01:00:00Z', end_at: '2026-10-31T02:00:00Z' },
    ]
    expect(await queueAppointmentCheckIns(db, 't1', at)).toBe(1)
    expect(tables.action_queue).toEqual([expect.objectContaining({ source: 'appointment', source_ref: 'e1', job_id: 'j79', status: 'queued', title: 'After: Belmont job (new order)' })])
    expect(await queueAppointmentCheckIns(db, 't1', at)).toBe(0)
    expect(await queueAppointmentCheckIns(db, 't1', new Date('2026-11-02T05:30:00Z'))).toBe(1) // the site meeting, two hours on
  })
})

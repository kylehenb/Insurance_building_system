import type { ScheduleKind } from '@/lib/schedule/schedule'

// Each kind's colour on the Calendar page (tech spec §23.18)
export const KIND_COLOURS: Record<ScheduleKind, string> = {
  inspection: '#2f5d8a',
  make_safe: '#b4532a',
  roof: '#6b4c9a',
  leak_detection: '#1f8a87',
  specialist: '#8a7a2a',
  repair: '#3f7a4a',
  appointment: '#7a7268',
}

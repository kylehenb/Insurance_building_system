import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Report writing learns from what the assessor changes in the AI's draft
// before locking the report — once per draft — and photo labels from the
// inspector's renames on the same report.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
// The report's job: the fake can't join, so the insurer is on the row
const { compareReport, recordReportsLocked, reportLearning, reportSituation, saveAiDraft } = await import('../learning')
const { photoLearning } = await import('@/lib/photos/learning')

const report = (extra: Row = {}): Row => ({
  id: 'r1', tenant_id: 't1', report_type: 'BAR', loss_type: 'Storm', assessor_name: 'Kyle', jobs: { insurer: 'Allianz' },
  cause_of_damage: 'Wind-driven rain through a cracked ridge cap.', conclusion: 'Repairs required.',
  ai_draft: { cause_of_damage: 'Storm damage.', conclusion: 'Repairs required. ', claim_number: 'C1', property_address: '1 Main St' },
  ai_draft_learned_at: null, photo_labels_learned_at: null, type_specific_fields: {},
  ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  vi.restoreAllMocks()
})

describe('compareReport', () => {
  it('lists rewritten and removed writing, not copied facts', () => {
    expect(compareReport({ cause_of_damage: 'Storm.', conclusion: 'Old', claim_number: 'C1', roof_type: ['Tile'] }, { cause_of_damage: 'Wind-driven rain.', conclusion: '', claim_number: 'C2', type_specific_fields: { roof_type: ['tile'] } }))
      .toEqual([
        'cause of damage: the AI wrote "Storm." — it went out as "Wind-driven rain."',
        'conclusion: the AI wrote "Old" — the assessor took it out',
      ])
  })
})

describe('saveAiDraft and recordReportsLocked', () => {
  it('keeps the draft, then records it once when the report is locked, with its photos', async () => {
    tables.reports = [report({ ai_draft: null })]
    await saveAiDraft(db as never, 't1', 'r1', { cause_of_damage: 'Storm damage.' })
    expect(tables.reports[0]).toMatchObject({ ai_draft: { cause_of_damage: 'Storm damage.' }, ai_draft_learned_at: null })
    tables.photos = [
      { tenant_id: 't1', report_id: 'r1', ai_seen: 'stained ceiling', ai_label: 'Lounge - stain', ai_kind: 'other', label: 'Family Room - water-stained ceiling' },
      { tenant_id: 't1', report_id: 'r1', ai_seen: 'oven', ai_label: 'Kitchen - oven', ai_kind: 'other', label: 'kitchen -  oven' },
      { tenant_id: 't1', report_id: 'r1', ai_seen: 'house', ai_label: 'Front', ai_kind: 'view_of_property', label: 'View of Property' },
      { tenant_id: 't1', report_id: 'other', ai_seen: 'x', ai_label: 'Hall', ai_kind: 'other', label: 'Hallway' },
    ]
    await recordReportsLocked(db as never, 't1', ['r1'], 'u1')
    await recordReportsLocked(db as never, 't1', ['r1'], 'u1')
    const [rep, photos] = tables.learning_events
    expect(tables.learning_events).toHaveLength(2)
    expect(rep).toMatchObject({ feature: 'report', source_id: 'r1', outcome: 'edited', kind: 'bar', user_id: 'u1', situation: { report_type: 'bar', insurer: 'Allianz', loss_type: 'Storm', assessor: 'Kyle' } })
    expect(rep.changes).toEqual(['cause of damage: the AI wrote "Storm damage." — it went out as "Wind-driven rain through a cracked ridge cap."'])
    expect(photos).toMatchObject({ feature: 'photo_labels', outcome: 'edited', changes: ['"Lounge - stain" → "Family Room - water-stained ceiling"'] })
    expect(tables.reports[0].ai_draft_learned_at).toBeTruthy()
    expect(tables.reports[0].photo_labels_learned_at).toBeTruthy()
  })

  it('records nothing for a report the AI didn\'t draft, or with no AI-labelled photos', async () => {
    tables.reports = [report({ ai_draft: null })]
    tables.photos = []
    await recordReportsLocked(db as never, 't1', ['r1'], 'u1')
    expect(tables.learning_events ?? []).toHaveLength(0)
  })
})

describe('reading it back', () => {
  it('gives the next draft the corrections on alike reports, and labelling the renames', async () => {
    tables.reports = [report()]
    tables.photos = [{ tenant_id: 't1', report_id: 'r1', ai_seen: 'stain', ai_label: 'Lounge - stain', ai_kind: 'other', label: 'Family Room - stain' }]
    await recordReportsLocked(db as never, 't1', ['r1'], 'u1')
    const text = await reportLearning(db as never, 't1', reportSituation({ reportType: 'BAR', insurer: 'Allianz', lossType: 'Storm' }), 'r2')
    expect(text).toContain('WHAT THE ASSESSORS DID IN SIMILAR PAST CASES')
    expect(text).toContain('cause of damage: the AI wrote "Storm damage."')
    expect(await reportLearning(db as never, 't1', reportSituation({ reportType: 'roof' }), 'r2')).toBe('')
    expect(await reportLearning(db as never, 't1', reportSituation({ reportType: 'BAR', insurer: 'Allianz', lossType: 'Storm' }), 'r1')).toBe('')
    const { corrections } = await photoLearning(db as never, 't1', { insurer: 'Suncorp', loss_type: null, report_type: 'bar' })
    expect(corrections).toEqual([{ seen: 'stain', aiLabel: 'Lounge - stain', finalLabel: 'Family Room - stain' }])
  })
})

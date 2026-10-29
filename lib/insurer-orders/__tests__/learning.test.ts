import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { compareOrder, orderLearning, orderSituation, recordOrderLodged } from '../learning'

// Order parsing learns from what the office corrects before lodging, and
// reads the corrections on orders from the same sender first.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

const order = (extra: Row = {}): Row & { id: string; tenant_id: string } => ({
  id: 'o1', tenant_id: 't1', entry_method: 'email', insurer: 'Allianz',
  order_sender_email: 'claims@allianz.com.au', order_sender_name: 'Claims', raw_email_subject: 'New order 123',
  situation: orderSituation({ fromEmail: 'Claims@Allianz.com.au', fromName: 'Claims', subject: 'New order 123', insurer: 'Allianz' }),
  gemini_output: { claim_number: 'C123', insured_name: 'jo smith', excess_building: 500, property_address: '1 Main St' },
  claim_number: 'C123', insured_name: 'Jo Smith', excess_building: '500.00', property_address: '1 Main Street, Perth',
  ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
})

describe('orderSituation', () => {
  it('keeps the sender, their domain unless free mail, insurer and subject', () => {
    expect(orderSituation({ fromEmail: 'Jane@Allianz.com.au', subject: ' WO 1 ', insurer: 'Allianz' }))
      .toEqual({ sender_email: 'jane@allianz.com.au', sender_name: null, sender_domain: 'allianz.com.au', insurer: 'Allianz', subject: 'WO 1' })
    expect(orderSituation({ fromEmail: 'bob@gmail.com' }).sender_domain).toBeNull()
  })
})

describe('compareOrder', () => {
  it('lists the fields the office corrected, ignoring case, spacing and number formatting', () => {
    const o = order()
    expect(compareOrder(o.gemini_output as Row, o)).toEqual(['property address: the AI read "1 Main St", the office lodged "1 Main Street, Perth"'])
    expect(compareOrder({ work_order_type: 'Make Safe' }, { wo_type: 'BAR' })).toEqual(['wo type: the AI read "make_safe", the office lodged "BAR"'])
    // The app's own mapping of the AI's wording isn't a correction
    expect(compareOrder({ loss_type: 'Storm', work_order_type: 'Make Safe' }, { loss_type: 'Storm or Rainwater', wo_type: 'make_safe' })).toEqual([])
  })
})

describe('recordOrderLodged', () => {
  it('records the corrections with the sender, and the insurer as the kind', async () => {
    await recordOrderLodged(db as never, order() as never, 'u1')
    expect(tables.learning_events[0]).toMatchObject({
      feature: 'order_parse', source_id: 'o1', outcome: 'edited', kind: 'Allianz', user_id: 'u1',
      situation: { sender_email: 'claims@allianz.com.au', insurer: 'Allianz' },
      situation_text: 'Order email from Claims <claims@allianz.com.au> (Allianz) — "New order 123"',
    })
  })

  it('records an order lodged as parsed as accepted, and nothing for one typed in by hand', async () => {
    await recordOrderLodged(db as never, order({ property_address: '1 Main St' }) as never, null)
    expect(tables.learning_events[0].outcome).toBe('accepted')
    await recordOrderLodged(db as never, order({ entry_method: 'manual' }) as never, null)
    await recordOrderLodged(db as never, order({ gemini_output: null }) as never, null)
    expect(tables.learning_events).toHaveLength(1)
  })
})

describe('orderLearning', () => {
  it('shows the parser the corrections on orders from the same sender', async () => {
    await recordOrderLodged(db as never, order() as never, 'u1')
    tables.learning_events.push({ id: 'x', tenant_id: 't1', feature: 'order_parse', situation: { sender_email: 'someone@else.com' }, situation_text: 'Other sender', changes: ['claim number: x'], outcome: 'edited', created_at: '2026-10-01' })
    const text = await orderLearning(db as never, 't1', orderSituation({ fromEmail: 'claims@allianz.com.au', subject: 'New order 456' }))
    expect(text).toContain('property address: the AI read "1 Main St", the office lodged "1 Main Street, Perth"')
    expect(text).not.toContain('Other sender')
  })
})

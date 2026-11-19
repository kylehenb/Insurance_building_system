import { describe, expect, it } from 'vitest'
import {
  mapWorkOrderType, mapWorkOrderTypes, orderWorkTypes, sortWorkTypes, unknownWorkTypes, workTypesLabel, workTypesPhrase,
} from '../work-order-type'
import { parsedWorkTypes } from '@/lib/email/order-parser'

describe('mapWorkOrderType', () => {
  it('maps the parser\'s wording to the app\'s types', () => {
    expect(mapWorkOrderType('Make Safe')).toBe('make_safe')
    expect(mapWorkOrderType('makesafe')).toBe('make_safe')
    expect(mapWorkOrderType('Building Assessment Report')).toBe('BAR')
    expect(mapWorkOrderType('BAR')).toBe('BAR')
    expect(mapWorkOrderType('Roof Report')).toBe('roof_report')
    expect(mapWorkOrderType('Leak Detection')).toBe('leak_detection')
    expect(mapWorkOrderType('Specialist Report')).toBe('specialist')
    expect(mapWorkOrderType('make_safe')).toBe('make_safe')
  })

  it('knows "Quote Only" (it was once saved as written, so no quote was made)', () => {
    expect(mapWorkOrderType('Quote Only')).toBe('quote_only')
    expect(mapWorkOrderType('quote_only')).toBe('quote_only')
    expect(mapWorkOrderType('quote')).toBe('quote_only')
  })

  it('doesn\'t read "bar" inside another word as a BAR', () => {
    expect(mapWorkOrderType('Barrier fence')).toBe('Barrier fence')
  })

  it('keeps wording it doesn\'t know, so the office sees it', () => {
    expect(mapWorkOrderType('Combination')).toBe('Combination')
    expect(mapWorkOrderType('')).toBeNull()
    expect(mapWorkOrderType(null)).toBeNull()
  })
})

describe('mapWorkOrderTypes', () => {
  it('reads a list, in the acknowledgement\'s order, without repeats', () => {
    expect(mapWorkOrderTypes(['BAR', 'Make Safe'])).toEqual(['make_safe', 'BAR'])
    expect(mapWorkOrderTypes(['Roof Report', 'BAR', 'bar'])).toEqual(['BAR', 'roof_report'])
    expect(mapWorkOrderTypes(['Quote Only', 'Make Safe'])).toEqual(['make_safe', 'quote_only'])
  })

  it('splits a single string naming several types', () => {
    expect(mapWorkOrderTypes('Make Safe and BAR')).toEqual(['make_safe', 'BAR'])
    expect(mapWorkOrderTypes('BAR + Roof Report')).toEqual(['BAR', 'roof_report'])
    expect(mapWorkOrderTypes('make safe, BAR & quote')).toEqual(['make_safe', 'BAR', 'quote_only'])
  })

  it('keeps wording whole when it isn\'t a list of types', () => {
    expect(mapWorkOrderTypes('Roof and gutter report')).toEqual(['roof_report'])
    expect(mapWorkOrderTypes('Combination')).toEqual(['Combination'])
  })

  it('is empty for nothing', () => {
    expect(mapWorkOrderTypes(null)).toEqual([])
    expect(mapWorkOrderTypes([])).toEqual([])
    expect(mapWorkOrderTypes('')).toEqual([])
  })
})

describe('order helpers', () => {
  it('reads the list, else the old single type', () => {
    expect(orderWorkTypes({ wo_types: ['BAR', 'make_safe'], wo_type: 'BAR' })).toEqual(['make_safe', 'BAR'])
    expect(orderWorkTypes({ wo_types: [], wo_type: 'Quote Only' })).toEqual(['quote_only'])
    expect(orderWorkTypes({ wo_type: null })).toEqual([])
  })

  it('labels and phrases', () => {
    expect(workTypesLabel(['BAR', 'make_safe'])).toBe('Make Safe + BAR')
    expect(workTypesPhrase(['BAR', 'make_safe'])).toBe('a make safe and a building assessment report')
    expect(workTypesPhrase(['BAR', 'roof_report', 'quote_only'])).toBe('a building assessment report, a roof report and a quote')
    expect(workTypesPhrase(['leak_detection'])).toBe('a leak detection')
    expect(workTypesPhrase([])).toBe('')
  })

  it('finds types it doesn\'t know', () => {
    expect(unknownWorkTypes(['BAR', 'variation'])).toEqual(['variation'])
    expect(sortWorkTypes(['quote_only', 'zzz', 'make_safe'])).toEqual(['make_safe', 'quote_only', 'zzz'])
  })
})

describe('parsedWorkTypes', () => {
  it('reads the parser\'s list, or an older prompt\'s single type', () => {
    expect(parsedWorkTypes({ work_order_types: ['Make Safe', 'BAR'] }, null)).toEqual(['make_safe', 'BAR'])
    expect(parsedWorkTypes({ work_order_type: 'Quote Only' }, null)).toEqual(['quote_only'])
  })

  it('uses the client\'s default type only when the email names none', () => {
    expect(parsedWorkTypes({ work_order_types: [] }, 'BAR')).toEqual(['BAR'])
    expect(parsedWorkTypes({ work_order_types: ['Make Safe'] }, 'BAR')).toEqual(['make_safe'])
  })
})

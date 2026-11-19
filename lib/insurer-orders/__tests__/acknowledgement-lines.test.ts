import { describe, expect, it } from 'vitest'
import { DEFAULT_WORK_TYPE_LINES, mergeWorkTypeLines, workTypeLinesFor, workTypeVars, workTypesProblem } from '../acknowledgement-lines'
import { runOrderChecks } from '../checks'

describe('acknowledgement lines', () => {
  it('merges per type: client over standard over defaults, ignoring blanks and unknown keys', () => {
    const merged = mergeWorkTypeLines({ BAR: 'Client BAR.', make_safe: '  ' }, { BAR: 'Standard BAR.', make_safe: 'Standard MS.', bogus: 'x' })
    expect(merged.BAR).toBe('Client BAR.')
    expect(merged.make_safe).toBe('Standard MS.')
    expect(merged.quote_only).toBe(DEFAULT_WORK_TYPE_LINES.quote_only)
    expect(Object.keys(merged)).not.toContain('bogus')
  })

  it('gives the lines in the app\'s order, placeholders filled, nothing for unknown types', () => {
    const lines = { ...DEFAULT_WORK_TYPE_LINES, roof_report: 'Roof at {property_address}.' }
    expect(workTypeLinesFor(['roof_report', 'make_safe', 'variation'], lines, { property_address: '1 Main St' }))
      .toEqual([DEFAULT_WORK_TYPE_LINES.make_safe, 'Roof at 1 Main St.'])
    expect(workTypeVars(['quote_only', 'make_safe'], lines)).toEqual({
      work_type_lines: `${DEFAULT_WORK_TYPE_LINES.make_safe} ${DEFAULT_WORK_TYPE_LINES.quote_only}`,
      work_types: 'a make safe and a quote',
    })
  })

  it('names the problem when the order\'s types are missing or unknown', () => {
    expect(workTypesProblem(['BAR'])).toBeNull()
    expect(workTypesProblem([])).toMatch(/no work type/)
    expect(workTypesProblem(['BAR', 'variation'])).toMatch(/"variation" isn't one the app knows/)
  })

  it('holds the acknowledgement through the order checks, only when the order\'s types are known to the caller', () => {
    expect(runOrderChecks({ insured_phone: '0412345678', wo_types: [] })[0]).toMatchObject({ key: 'work_types', holdAcknowledgement: expect.stringMatching(/no work type/) })
    expect(runOrderChecks({ insured_phone: '0412345678', wo_types: ['make_safe'] })).toEqual([])
    expect(runOrderChecks({ insured_phone: '0412345678' })).toEqual([])
  })
})

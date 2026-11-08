import { describe, it, expect } from 'vitest'
import { splitDotPoints, toDotPoints } from '../dot-points'

// The roof report's cause of damage: a lead line, then "• " points, whatever
// numbering or dashes the AI (or the inspector) used.

describe('toDotPoints', () => {
  it('keeps the lead line and turns dashes and bullets into "• " points', () => {
    expect(toDotPoints('Stormwater entry through a failed box gutter joint.\n-The sealant had failed\n- Staining to timber framing below\n• Joint not fixed properly')).toBe(
      'Stormwater entry through a failed box gutter joint.\n• The sealant had failed\n• Staining to timber framing below\n• Joint not fixed properly',
    )
  })

  it('splits a run-together "(1) … (2) …" list onto separate points', () => {
    expect(toDotPoints('Multiple factors: (1) tiles did not overlap the gutter; (2) incorrect falls on gutters; (3) 17 broken roof tiles.')).toBe(
      'Multiple factors:\n• Tiles did not overlap the gutter\n• Incorrect falls on gutters\n• 17 broken roof tiles.',
    )
  })

  it('handles numbered lines and drops blank lines', () => {
    expect(toDotPoints('Causes:\n\n1. Valley overflow\n2) Broken tile\n')).toBe('Causes:\n• Valley overflow\n• Broken tile')
  })

  it("doesn't mistake a measurement for numbering", () => {
    expect(toDotPoints('1.5m of gutter had pulled away')).toBe('1.5m of gutter had pulled away')
  })

  it('leaves a plain paragraph alone, and empty as empty', () => {
    expect(toDotPoints('No breaches were found in the roof cover.')).toBe('No breaches were found in the roof cover.')
    expect(toDotPoints('  ')).toBe('')
    expect(toDotPoints(null)).toBe('')
  })
})

describe('splitDotPoints', () => {
  it('marks the points apart from the lead line', () => {
    expect(splitDotPoints('Lead\n• One\n• Two')).toEqual([
      { point: false, text: 'Lead' },
      { point: true, text: 'One' },
      { point: true, text: 'Two' },
    ])
  })
})

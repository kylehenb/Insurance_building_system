import { describe, it, expect } from 'vitest'
import { cleanUncertain, reviewFlags } from '../roof-review'

// The roof report's review list: empty fields, the AI's guesses, and the fields always reviewed.

const base = {
  claimDetails: '', rooferName: '', attendanceDate: '05.11.2026',
  roofType: 'Concrete tile', roofPitch: '', solarPV: 'No',
  guttersCompliant: 'Yes', guttersNotes: '',
  skylightFlashingsWatertight: 'No', skylightFlashingsNotes: '',
  specificCause: 'Stormwater entry…', requiredMaintenanceDetails: '', recommendedMaintenanceDetails: 'Clean gutters',
  propertyAge: '30 years',
}

describe('reviewFlags', () => {
  it('flags empty fields, the AI guesses and the always-reviewed fields', () => {
    const flags = reviewFlags(base, ['propertyAge', 'roofType'])
    expect(Object.fromEntries(flags)).toEqual({
      roofPitch: 'empty',
      skylightFlashingsNotes: 'empty',
      specificCause: 'always',
      requiredMaintenanceDetails: 'always',
      recommendedMaintenanceDetails: 'always',
      propertyAge: 'check',
      roofType: 'check',
    })
  })

  it("doesn't ask for a detail box the answer doesn't need, or fields the report fills itself", () => {
    const flags = reviewFlags(base)
    expect(flags.has('guttersNotes')).toBe(false) // gutters are compliant
    expect(flags.has('claimDetails')).toBe(false)
    expect(flags.has('rooferName')).toBe(false)
  })
})

describe('cleanUncertain', () => {
  it('keeps known field keys once', () => {
    expect(cleanUncertain(['roofType', 'roofType', 'nope', 3, 'rooferName'], base)).toEqual(['roofType'])
    expect(cleanUncertain('roofType', base)).toEqual([])
  })
})

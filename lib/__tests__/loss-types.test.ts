import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOSS_TYPES, normaliseLossType } from '../loss-types'

describe('normaliseLossType', () => {
  it.each([
    ['Storm or Rainwater', 'Storm or Rainwater'],
    ['storm or rainwater', 'Storm or Rainwater'],
    ['Storm', 'Storm or Rainwater'],
    ['Storm - water ingress via roof', 'Storm or Rainwater'],
    ['storm/rainwater ingress', 'Storm or Rainwater'],
    ['Wind', 'Storm or Rainwater'],
    ['Escape of Liquid', 'Escape of Liquids'],
    ['Escape of liquid - burst water supply pipe', 'Escape of Liquids'],
    ['Burst Pipe', 'Escape of Liquids'],
    ['Water Damage', 'Escape of Liquids'],
    ['Fire', 'Fire or Smoke'],
    ['Damage by Theives', 'Theft and / or Damage by Thieves'],
    ['Impact by Vehicle', 'Impact or Collision by Vehicle'],
    ['Vandalism', 'Malicious Act or Vandalism'],
    ['Storm — falling tree', 'Impact by Falling Trees'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseLossType(input)).toBe(expected)
  })

  it('returns null for unknown or empty values', () => {
    expect(normaliseLossType('Ceiling Damage')).toBeNull()
    expect(normaliseLossType('')).toBeNull()
    expect(normaliseLossType(null)).toBeNull()
    expect(normaliseLossType(42)).toBeNull()
  })

  it('every list value maps to itself', () => {
    for (const t of LOSS_TYPES) expect(normaliseLossType(t)).toBe(t)
  })
})

describe('database constraint', () => {
  it('lists exactly the same loss types as lib/loss-types.ts', () => {
    const sql = readFileSync('supabase/migrations/20261010_loss_type_list.sql', 'utf8')
    const constraint = sql.slice(sql.indexOf('ADD CONSTRAINT jobs_loss_type_valid'))
    const inList = constraint.slice(constraint.indexOf('IN ('), constraint.indexOf('));'))
    const values = [...inList.matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(values).toEqual([...LOSS_TYPES])
  })
})

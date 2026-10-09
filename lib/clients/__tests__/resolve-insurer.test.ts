import { describe, it, expect } from 'vitest'
import { matchInsurerClient, type InsurerClientCandidate } from '../resolve-insurer'

const castle: InsurerClientCandidate = { id: 'castle', name: 'Castle Insurance', trading_name: null }
const allianz: InsurerClientCandidate = { id: 'allianz', name: 'Allianz', trading_name: 'Allianz Australia Insurance Ltd' }
const suncorp: InsurerClientCandidate = { id: 'suncorp', name: 'Suncorp', trading_name: null }
const clients = [castle, allianz, suncorp]

describe('matchInsurerClient', () => {
  it('matches a short parsed name to a longer client name', () => {
    expect(matchInsurerClient(clients, { insurer: 'Castle' })).toBe(castle)
  })

  it('matches a long legal name to a short client name', () => {
    expect(matchInsurerClient(clients, { insurer: 'CASTLE INSURANCE PTY LTD' })).toBe(castle)
    expect(matchInsurerClient([{ id: 'c', name: 'Castle', trading_name: null }], { insurer: 'Castle Insurance Pty Ltd' })?.id).toBe('c')
  })

  it('matches via trading name', () => {
    expect(matchInsurerClient(clients, { insurer: 'allianz australia' })).toBe(allianz)
  })

  it('falls back to the sender email when the insurer is blank', () => {
    expect(matchInsurerClient(clients, { insurer: null, fromEmail: 'castleinsurance.mailer@primeeco.tech' })).toBe(castle)
  })

  it('falls back to subject then body', () => {
    expect(matchInsurerClient(clients, { subject: 'New Castle work order CHCCLM123' })).toBe(castle)
    expect(matchInsurerClient(clients, { body: 'Castle Castle ... previously with Suncorp' })).toBe(castle)
  })

  it('does not match a word that merely contains the name', () => {
    expect(matchInsurerClient(clients, { subject: 'Job at Castletown WA' })).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchInsurerClient(clients, { insurer: 'QBE', subject: 'Hello' })).toBeNull()
    expect(matchInsurerClient([], { insurer: 'Castle' })).toBeNull()
  })
})

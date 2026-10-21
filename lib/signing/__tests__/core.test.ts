import { describe, expect, it } from 'vitest'
import { generateSigningToken, hashSigningToken, isWellFormedToken, digestsEqual, sha256Hex } from '../tokens'
import { effectiveStatus } from '../types'
import { signerLinkState, parseSignatureInput } from '../in-house/signer'
import { suggestDocumentType } from '../documents/catalog'
import { describeDevice, formatPerthDateTime, formatSigningDate, formatUtcDateTime } from '../format'
import { requestMeta } from '../request-meta'

describe('signing tokens', () => {
  it('are 256-bit base64url and unique', () => {
    const a = generateSigningToken()
    const b = generateSigningToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(isWellFormedToken(a)).toBe(true)
  })

  it('rejects malformed tokens before any lookup', () => {
    for (const bad of ['', 'short', 'x'.repeat(44), 'a'.repeat(42) + '/', null, undefined]) {
      expect(isWellFormedToken(bad as string)).toBe(false)
    }
  })

  it('stores only a SHA-256 hash', () => {
    const t = generateSigningToken()
    const h = hashSigningToken(t)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashSigningToken(t))
    expect(h).not.toContain(t)
    expect(digestsEqual(h, sha256Hex(t))).toBe(true)
    expect(digestsEqual(h, hashSigningToken(generateSigningToken()))).toBe(false)
  })
})

describe('request status', () => {
  const now = new Date('2026-10-21T00:00:00Z')
  const past = '2026-10-20T00:00:00Z'
  const future = '2026-10-30T00:00:00Z'

  it('reads an open request past its expiry as expired', () => {
    expect(effectiveStatus({ status: 'sent', expires_at: past }, now)).toBe('expired')
    expect(effectiveStatus({ status: 'viewed', expires_at: future }, now)).toBe('viewed')
    expect(effectiveStatus({ status: 'signed', expires_at: past }, now)).toBe('signed')
  })

  it('signer link states', () => {
    expect(signerLinkState({ status: 'draft', expires_at: null, viewed_at: null }, now)).toBe('not_found')
    expect(signerLinkState({ status: 'sent', expires_at: future, viewed_at: null }, now)).toBe('open')
    expect(signerLinkState({ status: 'signed', expires_at: future, viewed_at: null }, now)).toBe('signed')
    expect(signerLinkState({ status: 'revoked', expires_at: future, viewed_at: null }, now)).toBe('revoked')
    expect(signerLinkState({ status: 'sent', expires_at: past, viewed_at: null }, now)).toBe('expired')
  })

  it('gives a signer who opened the link before expiry a grace period to finish', () => {
    const expires = '2026-10-20T20:00:00Z' // 4 hours before "now"
    expect(signerLinkState({ status: 'viewed', expires_at: expires, viewed_at: '2026-10-20T19:50:00Z' }, now)).toBe('open')
    expect(signerLinkState({ status: 'expired', expires_at: expires, viewed_at: '2026-10-20T19:50:00Z' }, now)).toBe('open')
    // opened after expiry: no grace
    expect(signerLinkState({ status: 'sent', expires_at: expires, viewed_at: '2026-10-20T21:00:00Z' }, now)).toBe('expired')
    // grace is 24h
    expect(signerLinkState({ status: 'viewed', expires_at: '2026-10-19T20:00:00Z', viewed_at: '2026-10-19T19:00:00Z' }, now)).toBe('expired')
  })
})

describe('signature input', () => {
  it('defaults to a typed signature with a known style', () => {
    expect(parseSignatureInput({ method: null, typedName: '  Jane   Citizen ', style: 'nope', drawnPng: null }))
      .toEqual({ method: 'typed', text: 'Jane Citizen', styleKey: 'great_vibes' })
    expect(parseSignatureInput({ method: 'typed', typedName: 'Jane', style: 'allura', drawnPng: null }))
      .toMatchObject({ styleKey: 'allura' })
  })

  it('rejects empty or oversized typed names', () => {
    expect(() => parseSignatureInput({ method: 'typed', typedName: ' ', style: null, drawnPng: null })).toThrow(/full name/)
    expect(() => parseSignatureInput({ method: 'typed', typedName: 'x'.repeat(81), style: null, drawnPng: null })).toThrow(/too long/)
  })

  it('accepts only real PNG data URLs for drawn signatures', () => {
    expect(() => parseSignatureInput({ method: 'drawn', typedName: null, style: null, drawnPng: 'data:image/png;base64,AAAA' })).toThrow(/draw/)
    expect(() => parseSignatureInput({ method: 'drawn', typedName: null, style: null, drawnPng: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow()
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400)])
    const parsed = parseSignatureInput({ method: 'drawn', typedName: null, style: null, drawnPng: `data:image/png;base64,${png.toString('base64')}` })
    expect(parsed.method).toBe('drawn')
  })
})

describe('document type suggestion', () => {
  it('uses a Building Contract over $7,500', () => {
    expect(suggestDocumentType(7500)).toBe('scope_of_works')
    expect(suggestDocumentType(7500.01)).toBe('building_contract')
    expect(suggestDocumentType(0)).toBe('scope_of_works')
  })
})

describe('formatting', () => {
  it('shows Perth time and UTC', () => {
    const d = new Date('2026-10-20T23:52:19Z')
    expect(formatSigningDate(d)).toBe('21 Oct 2026')
    expect(formatPerthDateTime(d)).toMatch(/^21 Oct 2026, 7:52:19\s?am AWST$/)
    expect(formatUtcDateTime(d)).toBe('2026-10-20 23:52:19 UTC')
  })

  it('describes common devices', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1'))
      .toBe('Safari on iPhone (iOS 15.8)')
    expect(describeDevice('Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0 Mobile Safari/537.36'))
      .toBe('Chrome on Android 10')
    expect(describeDevice(null)).toBe('Unknown device')
  })

  it('takes the client IP from platform headers and ignores junk', () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null })
    expect(requestMeta(h({ 'x-real-ip': '203.0.113.9', 'user-agent': 'UA' }))).toEqual({ ip: '203.0.113.9', userAgent: 'UA' })
    expect(requestMeta(h({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })).ip).toBe('198.51.100.1')
    expect(requestMeta(h({ 'x-real-ip': '<script>' })).ip).toBeNull()
  })
})

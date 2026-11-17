import { describe, it, expect, beforeAll } from 'vitest'
import { parsePreviewTarget, previewLink, previewToken, readPreviewToken, PREVIEW_LINK_HOURS } from '../preview'

// Preview links: signed for one tenant's one document, and only for a day.

const WO = '11111111-2222-3333-4444-555555555555'

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})

describe('preview links', () => {
  it('reads back the tenant and document it was made for', () => {
    const token = previewToken('t1', { kind: 'quote', id: WO })
    expect(readPreviewToken(token)).toEqual({ tenantId: 't1', target: { kind: 'quote', id: WO } })
    expect(previewLink('t1', { kind: 'work_order', id: WO })).toMatch(/^https:\/\/app\.test\/api\/preview\/[\w-]+\.[\w-]+$/)
  })

  it('runs out after a day', () => {
    const now = Date.now()
    const token = previewToken('t1', { kind: 'work_order', id: WO }, now)
    expect(readPreviewToken(token, now + (PREVIEW_LINK_HOURS - 1) * 3_600_000)).not.toBeNull()
    expect(readPreviewToken(token, now + (PREVIEW_LINK_HOURS + 1) * 3_600_000)).toBeNull()
  })

  it('refuses a changed or forged token', () => {
    const token = previewToken('t1', { kind: 'invoice', id: WO })
    const [, mac] = token.split('.')
    const otherTenant = Buffer.from(JSON.stringify({ t: 't2', d: { kind: 'invoice', id: WO }, e: Date.now() + 1e9 })).toString('base64url')
    expect(readPreviewToken(`${otherTenant}.${mac}`)).toBeNull()
    expect(readPreviewToken(`${token}x`)).toBeNull()
    expect(readPreviewToken('nonsense')).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'another-key'
    expect(readPreviewToken(token)).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  })

  it('only takes real documents', () => {
    expect(() => parsePreviewTarget({ kind: 'work_order', id: 'abc' })).toThrow('Work order not found')
    expect(() => parsePreviewTarget({ kind: 'spreadsheet', id: WO })).toThrow()
  })
})

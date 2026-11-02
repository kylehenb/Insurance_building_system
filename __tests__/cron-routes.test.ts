import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { CRON_ROUTES } from '../lib/cron-routes'

// Vercel calls the crons with no session, so the proxy must let each one
// through (it would send them to the login page otherwise) — and each one
// must check the CRON_SECRET bearer itself.

const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }).crons.map(c => c.path)

describe('the crons', () => {
  it('are all let through the proxy', () => {
    const blocked = crons.filter(p => !p.startsWith('/api/gmail/') && !CRON_ROUTES.has(p))
    expect(blocked).toEqual([])
  })

  it('each check the CRON_SECRET themselves', () => {
    for (const path of crons) {
      const file = `app${path}/route.ts`
      expect(existsSync(file), file).toBe(true)
      expect(readFileSync(file, 'utf8'), file).toContain('CRON_SECRET')
    }
  })
})

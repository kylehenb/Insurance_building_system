import { createServiceClient } from '@/lib/supabase/server'
import { REMINDER_DEFAULTS } from './config'
import { SigningError } from './provider'
import { pruneRateLimits } from './rate-limit'
import { persistExpiryIfDue } from './repository'
import { getSigningProvider } from './service'

// Reminders for unsigned requests. Not on a schedule yet: call
// sendSigningReminders() from a cron route when you're ready
// (e.g. add { "path": "/api/signing/reminders", "schedule": "0 1 * * *" }
// to vercel.json with a CRON_SECRET-checked route).
//
// A reminder emails a fresh link (the previous one stops working) and keeps
// the expiry 14 days from the reminder. Requests already expired or revoked
// are left alone; the office decides whether to resend those.

export interface ReminderOptions {
  /** Remind when this many days have passed since the last send/reminder */
  afterDays?: number
  /** Never send more than this many reminders per request */
  maxReminders?: number
  /** Limit to one tenant (default: all tenants) */
  tenantId?: string
  /** List what would be sent without sending */
  dryRun?: boolean
}

export interface ReminderResult {
  checked: number
  reminded: string[]
  skipped: { id: string; reason: string }[]
  failed: { id: string; error: string }[]
}

export async function sendSigningReminders(options: ReminderOptions = {}): Promise<ReminderResult> {
  const afterDays = options.afterDays ?? REMINDER_DEFAULTS.afterDays
  const maxReminders = options.maxReminders ?? REMINDER_DEFAULTS.maxReminders
  const service = createServiceClient()
  const cutoff = new Date(Date.now() - afterDays * 86400_000)

  let query = service
    .from('signing_requests')
    .select('*')
    .in('status', ['sent', 'viewed'])
    .lt('sent_at', cutoff.toISOString())
    .lt('reminder_count', maxReminders)
  if (options.tenantId) query = query.eq('tenant_id', options.tenantId)
  const { data, error } = await query
  if (error) throw new SigningError(`Reminder query failed: ${error.message}`, 500)

  const result: ReminderResult = { checked: data?.length ?? 0, reminded: [], skipped: [], failed: [] }
  for (const original of data ?? []) {
    const row = await persistExpiryIfDue(service, original)
    if (row.status === 'expired') {
      result.skipped.push({ id: row.id, reason: 'expired' })
      continue
    }
    const last = new Date(row.last_reminded_at ?? row.sent_at ?? row.created_at)
    if (last > cutoff) {
      result.skipped.push({ id: row.id, reason: 'recently sent' })
      continue
    }
    if (!row.signer_email) {
      result.skipped.push({ id: row.id, reason: 'no email' })
      continue
    }
    if (options.dryRun) {
      result.reminded.push(row.id)
      continue
    }
    try {
      await getSigningProvider().send({ tenantId: row.tenant_id, userId: null }, row.id, { reminder: true })
      result.reminded.push(row.id)
    } catch (err) {
      result.failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!options.dryRun) await pruneRateLimits(service)
  return result
}

import type { SupabaseClient } from '@supabase/supabase-js'

// Auto-confirm (tech spec §24.7): a kind of proposal (an action card's
// category) can be set to run without a person confirming it. It's off
// until someone turns it on. Once a kind has been confirmed untouched for
// 98% of its last 20 decisions, the office is asked whether to turn it on
// (a banner); "Not now" asks again 30 days later if it's still that good.

export const AUTO_CONFIRM = { last: 20, accuracy: 98, askAgainDays: 30 } as const

export type Readiness = { decided: number; accepted: number; pct: number | null; ready: boolean }

export type AutoConfirmState = {
  feature: string
  kind: string
  enabled: boolean
  changed_by: string | null
  changed_at: string | null
  /** The office is being asked whether to turn it on */
  suggested: boolean
  readiness: Readiness
}

type Row = { tenant_id: string; feature: string; kind: string; enabled: boolean; changed_by: string | null; changed_at: string | null; suggested_at: string | null; dismissed_at: string | null }

const COLUMNS = 'tenant_id, feature, kind, enabled, changed_by, changed_at, suggested_at, dismissed_at'

/** A suggestion is waiting when it was made after the last "Not now" */
const waiting = (r: Row | undefined) => !!r && !r.enabled && !!r.suggested_at && (!r.dismissed_at || r.dismissed_at < r.suggested_at)

/** How the last 20 decisions on this kind went (instructions aren't decisions) */
export async function readiness(db: SupabaseClient, tenantId: string, feature: string, kind: string): Promise<Readiness> {
  const { data } = await db.from('learning_events').select('outcome')
    .eq('tenant_id', tenantId).eq('feature', feature).eq('kind', kind).neq('outcome', 'instructed')
    .order('created_at', { ascending: false }).limit(AUTO_CONFIRM.last)
  const rows = (data ?? []) as { outcome: string }[]
  const accepted = rows.filter(r => r.outcome === 'accepted').length
  const pct = rows.length ? Math.round((accepted / rows.length) * 100) : null
  return { decided: rows.length, accepted, pct, ready: rows.length >= AUTO_CONFIRM.last && (pct ?? 0) >= AUTO_CONFIRM.accuracy }
}

async function rows(db: SupabaseClient, tenantId: string, feature?: string): Promise<Row[]> {
  let q = db.from('learning_auto_confirm').select(COLUMNS).eq('tenant_id', tenantId)
  if (feature) q = q.eq('feature', feature)
  const { data } = await q
  return (data ?? []) as Row[]
}

async function save(db: SupabaseClient, existing: Row | undefined, row: Partial<Row> & Pick<Row, 'tenant_id' | 'feature' | 'kind'>): Promise<void> {
  const { error } = existing
    ? await db.from('learning_auto_confirm').update(row).eq('tenant_id', row.tenant_id).eq('feature', row.feature).eq('kind', row.kind)
    : await db.from('learning_auto_confirm').insert({ enabled: false, ...row })
  if (error) throw new Error(error.message)
}

/** Each kind's switch, readiness and whether the office is being asked */
export async function autoConfirmState(db: SupabaseClient, tenantId: string, feature: string, kinds: string[]): Promise<AutoConfirmState[]> {
  const saved = await rows(db, tenantId, feature)
  return Promise.all(kinds.map(async kind => {
    const r = saved.find(x => x.kind === kind)
    return {
      feature, kind,
      enabled: !!r?.enabled, changed_by: r?.changed_by ?? null, changed_at: r?.changed_at ?? null,
      suggested: waiting(r),
      readiness: await readiness(db, tenantId, feature, kind),
    }
  }))
}

/** Who auto-confirmed proposals of this kind run as, when it's on; null when off. Never throws */
export async function autoConfirmFor(db: SupabaseClient, tenantId: string, feature: string, kind: string): Promise<{ userId: string } | null> {
  try {
    const { data } = await db.from('learning_auto_confirm').select('enabled, changed_by')
      .eq('tenant_id', tenantId).eq('feature', feature).eq('kind', kind).maybeSingle()
    const r = data as { enabled: boolean; changed_by: string | null } | null
    return r?.enabled && r.changed_by ? { userId: r.changed_by } : null
  } catch (err) {
    console.error(`[learning] auto-confirm for ${feature}/${kind} not read:`, err)
    return null
  }
}

/** Turns auto-confirm on or off for a kind; it then runs as this person */
export async function setAutoConfirm(db: SupabaseClient, tenantId: string, feature: string, kind: string, enabled: boolean, userId: string): Promise<void> {
  const existing = (await rows(db, tenantId, feature)).find(r => r.kind === kind)
  await save(db, existing, { tenant_id: tenantId, feature, kind, enabled, changed_by: userId, changed_at: new Date().toISOString() })
}

/** "Not now": stop asking until it's been good for another 30 days */
export async function dismissAutoConfirm(db: SupabaseClient, tenantId: string, feature: string, kind: string, now = new Date()): Promise<void> {
  const existing = (await rows(db, tenantId, feature)).find(r => r.kind === kind)
  await save(db, existing, { tenant_id: tenantId, feature, kind, dismissed_at: now.toISOString() })
}

/**
 * Asks about kinds that have become ready (and stops asking about ones that
 * no longer are). Run by the nightly review and when the page loads. Returns
 * the kinds newly asked about.
 */
export async function refreshAutoConfirmSuggestions(db: SupabaseClient, tenantId: string, feature: string, kinds: string[], now = new Date()): Promise<string[]> {
  const saved = await rows(db, tenantId, feature)
  const asked: string[] = []
  for (const kind of kinds) {
    const r = saved.find(x => x.kind === kind)
    if (r?.enabled) continue
    const { ready } = await readiness(db, tenantId, feature, kind)
    if (!ready) {
      if (waiting(r)) await save(db, r, { tenant_id: tenantId, feature, kind, suggested_at: null })
      continue
    }
    if (waiting(r)) continue
    const lastNo = r?.dismissed_at ? new Date(r.dismissed_at).getTime() : 0
    if (lastNo && now.getTime() - lastNo < AUTO_CONFIRM.askAgainDays * 86_400_000) continue
    await save(db, r, { tenant_id: tenantId, feature, kind, suggested_at: now.toISOString() })
    asked.push(kind)
  }
  return asked
}

/** What the office is being asked about, across features */
export async function pendingAutoConfirm(db: SupabaseClient, tenantId: string): Promise<{ feature: string; kind: string; readiness: Readiness }[]> {
  const out: { feature: string; kind: string; readiness: Readiness }[] = []
  for (const r of (await rows(db, tenantId)).filter(waiting)) {
    out.push({ feature: r.feature, kind: r.kind, readiness: await readiness(db, tenantId, r.feature, r.kind) })
  }
  return out
}

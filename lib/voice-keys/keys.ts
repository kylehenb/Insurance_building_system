import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'

// Per-person keys for the Claude voice connector (Settings → Voice connector).
// The connector acts as the key's owner, with their permissions. Only the
// SHA-256 of a key is stored; the key is shown once, when it's made.

type Service = SupabaseClient<Database>

/** Every personal key starts with this, so the connector knows to look it up */
export const VOICE_KEY_PREFIX = 'irc_vk_'
const MAX_KEYS_PER_PERSON = 5
const MAX_LABEL_CHARS = 60
/** last_used_at is only rewritten when older than this, to keep requests cheap */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000

export class VoiceKeyError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404) {
    super(message)
    this.name = 'VoiceKeyError'
  }
}

export const hashVoiceKey = (key: string) => createHash('sha256').update(key).digest('hex')

export interface VoiceKeyView {
  id: string
  userId: string
  userName: string | null
  label: string
  hint: string
  createdAt: string
  lastUsedAt: string | null
}

/** Makes a key for a person. Returns the key itself — the only time it's available. */
export async function createVoiceKey(params: {
  tenantId: string
  userId: string
  label: string
  createdBy: string
  service?: Service
}): Promise<{ key: string; view: VoiceKeyView }> {
  const service = params.service ?? createServiceClient()
  const label = params.label.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_CHARS)
  if (!label) throw new VoiceKeyError('Give the key a name, e.g. "Kyle\'s iPhone".', 400)

  const { data: owner } = await service.from('users').select('id, name').eq('tenant_id', params.tenantId).eq('id', params.userId).maybeSingle()
  if (!owner) throw new VoiceKeyError('User not found', 404)
  const { data: active } = await service.from('voice_keys').select('id')
    .eq('tenant_id', params.tenantId).eq('user_id', params.userId).is('revoked_at', null)
  if ((active ?? []).length >= MAX_KEYS_PER_PERSON) {
    throw new VoiceKeyError(`${owner.name ?? 'This person'} already has ${MAX_KEYS_PER_PERSON} keys — revoke one first.`, 400)
  }

  const key = VOICE_KEY_PREFIX + randomBytes(24).toString('hex')
  const { data, error } = await service.from('voice_keys').insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    label,
    key_hash: hashVoiceKey(key),
    key_hint: key.slice(-4),
    created_by: params.createdBy,
  }).select('id, created_at').single()
  if (error || !data) throw new Error(`Could not save the key: ${error?.message ?? 'no row'}`)

  return {
    key,
    view: { id: data.id, userId: params.userId, userName: owner.name, label, hint: key.slice(-4), createdAt: data.created_at, lastUsedAt: null },
  }
}

/** Active keys — one person's, or everyone's in the company when userId is omitted */
export async function listVoiceKeys(tenantId: string, userId?: string, service: Service = createServiceClient()): Promise<VoiceKeyView[]> {
  let q = service.from('voice_keys').select('id, user_id, label, key_hint, created_at, last_used_at')
    .eq('tenant_id', tenantId).is('revoked_at', null)
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  const rows = data ?? []
  const ids = [...new Set(rows.map(r => r.user_id))]
  const { data: users } = ids.length
    ? await service.from('users').select('id, name').eq('tenant_id', tenantId).in('id', ids)
    : { data: [] as { id: string; name: string }[] }
  const names = new Map((users ?? []).map(u => [u.id, u.name]))
  return rows.map(r => ({
    id: r.id, userId: r.user_id, userName: names.get(r.user_id) ?? null, label: r.label,
    hint: r.key_hint, createdAt: r.created_at, lastUsedAt: r.last_used_at,
  }))
}

/** Revokes a key: its owner can, and so can someone allowed to manage users (canManage). */
export async function revokeVoiceKey(params: {
  tenantId: string
  id: string
  by: string
  canManage: boolean
  service?: Service
}): Promise<void> {
  const service = params.service ?? createServiceClient()
  const { data: row } = await service.from('voice_keys').select('id, user_id, revoked_at')
    .eq('tenant_id', params.tenantId).eq('id', params.id).maybeSingle()
  if (!row || row.revoked_at) throw new VoiceKeyError('Key not found', 404)
  if (row.user_id !== params.by && !params.canManage) throw new VoiceKeyError('You can only revoke your own keys.', 403)
  const { error } = await service.from('voice_keys')
    .update({ revoked_at: new Date().toISOString(), revoked_by: params.by })
    .eq('tenant_id', params.tenantId).eq('id', row.id)
  if (error) throw error
}

/** The active key's owner, or null. Notes when it was last used. */
export async function findVoiceKey(key: string, service: Service): Promise<{ id: string; tenantId: string; userId: string } | null> {
  const { data: row, error } = await service.from('voice_keys')
    .select('id, tenant_id, user_id, last_used_at').eq('key_hash', hashVoiceKey(key)).is('revoked_at', null).maybeSingle()
  if (error) throw error
  if (!row) return null
  // The owner must still be in that company
  const { data: user } = await service.from('users').select('tenant_id').eq('id', row.user_id).maybeSingle()
  if (user?.tenant_id !== row.tenant_id) return null

  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > LAST_USED_RESOLUTION_MS) {
    const { error: touchErr } = await service.from('voice_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
    if (touchErr) console.error('[mcp] could not note key use:', touchErr)
  }
  return { id: row.id, tenantId: row.tenant_id, userId: row.user_id }
}

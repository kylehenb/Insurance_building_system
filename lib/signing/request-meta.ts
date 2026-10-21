import { createHash } from 'node:crypto'

// Client IP and user agent for the audit trail. On Vercel, x-real-ip and
// x-forwarded-for are set by the platform edge (client-supplied values are
// overwritten), so the first address is the signer's.

export interface RequestMeta {
  ip: string | null
  userAgent: string | null
}

type HeaderSource = { get(name: string): string | null }

export function requestMeta(headers: HeaderSource): RequestMeta {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = headers.get('x-real-ip')?.trim() || forwarded || null
  const userAgent = headers.get('user-agent')?.slice(0, 500) || null
  return { ip: ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null, userAgent }
}

/** Rate-limit key part for an IP, hashed so raw IPs aren't used as keys. */
export function ipKey(ip: string | null): string {
  return createHash('sha256').update(ip ?? 'unknown').digest('hex').slice(0, 32)
}

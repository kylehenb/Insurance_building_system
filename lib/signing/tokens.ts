import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Signing link tokens: 32 random bytes (256 bits), base64url. Only the
// SHA-256 hash is stored (signing_requests.token_hash); the raw token exists
// in the email link and nowhere else.

const TOKEN_BYTES = 32
// base64url of 32 bytes is 43 characters
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function generateSigningToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Cheap shape check before any database lookup. */
export function isWellFormedToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token)
}

export function hashSigningToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function sha256Hex(data: Uint8Array | Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Constant-time comparison of two hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb)
}

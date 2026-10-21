import { NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { SigningError, type SigningActor } from './provider'

// Helpers for the internal (signed-in) signing API routes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value)
}

/** The signed-in office user's tenant, or null. */
export async function signingActorFromSession(): Promise<SigningActor | null> {
  const user = await getUser()
  if (!user?.tenant_id || !user.user || !user.session) return null
  return { tenantId: user.tenant_id, userId: user.session.user.id }
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function signingErrorResponse(err: unknown, action: string) {
  if (err instanceof SigningError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error(`[signing] ${action} failed:`, err)
  return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
}

export function pdfResponse(pdf: Buffer, filename: string, disposition: 'inline' | 'attachment' = 'inline') {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

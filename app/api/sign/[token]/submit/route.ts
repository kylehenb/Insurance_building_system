import { NextRequest, NextResponse } from 'next/server'
import { submitSignature, type SubmitSignatureInput } from '@/lib/signing/in-house/signer'
import { SigningError } from '@/lib/signing/provider'
import { requestMeta } from '@/lib/signing/request-meta'

// Public (no login). The signer page's form posts here (a plain HTML form,
// so it works without JavaScript). Always answers with a redirect back to the
// page, which shows the confirmation or a friendly error.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function errorCode(err: unknown): string {
  if (!(err instanceof SigningError)) return 'failed'
  if (err.status === 429) return 'rate'
  if (err.status === 409 && /already being signed/.test(err.message)) return 'busy'
  if (err.status === 400 && /draw/i.test(err.message)) return 'drawn'
  if (err.status === 400) return 'name'
  return 'failed'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const page = new URL(`/sign/${encodeURIComponent(token)}`, req.url)

  let input: SubmitSignatureInput
  try {
    const form = await req.formData()
    const str = (k: string) => {
      const v = form.get(k)
      return typeof v === 'string' ? v : null
    }
    input = { method: str('method'), typedName: str('typed_name'), style: str('style'), drawnPng: str('drawn_png'), capacity: str('capacity') }
  } catch {
    page.searchParams.set('error', 'failed')
    return NextResponse.redirect(page, 303)
  }

  try {
    await submitSignature(token, input, requestMeta(req.headers))
    page.searchParams.set('done', '1')
  } catch (err) {
    // Signed, expired, cancelled or unknown links: the page explains itself
    if (err instanceof SigningError && [404, 409, 410].includes(err.status) && !/already being signed/.test(err.message)) {
      return NextResponse.redirect(page, 303)
    }
    if (!(err instanceof SigningError) || err.status >= 500) console.error('[sign/submit] failed:', err)
    page.searchParams.set('error', errorCode(err))
    page.hash = 'finish'
  }
  return NextResponse.redirect(page, 303)
}

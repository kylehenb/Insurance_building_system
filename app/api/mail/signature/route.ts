import { NextResponse } from 'next/server'
import { composeAccess } from '@/lib/mail/access'
import { signatureForEditor, signatureHtml } from '@/lib/email/rich-text'
import { emailSignatureFor, type SignatureTenant } from '@/lib/email/signature'
import { STANDARD_EMAIL_FONT_SIZE } from '@/lib/email/email-html'
import { mailDb } from '@/lib/mail/sync'

// GET /api/mail/signature — the company signature: html as it's added to
// sent email (previews), editor as text the composer writes into the email
// (with its logo, for a {logo} line). { html: null, editor: null } when none is set up.
export async function GET(): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access
  const { data } = await mailDb()
    .from('tenants')
    .select('name, trading_name, email_signature, email_signature_image_path, email_signature_image_width, email_signature_image_height')
    .eq('id', access.tenantId)
    .single()
  const signature = data ? emailSignatureFor(data as SignatureTenant) : null
  return NextResponse.json({
    html: signature ? signatureHtml(signature, STANDARD_EMAIL_FONT_SIZE) : null,
    editor: signature ? signatureForEditor(signature, STANDARD_EMAIL_FONT_SIZE) : null,
    logo: signature?.image ? { url: signature.image.url, width: signature.image.width, height: signature.image.height } : null,
  })
}

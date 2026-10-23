import { richToText, SIGNATURE_LOGO_TOKEN, toRichHtml, type EmailSignature } from './rich-text'

// The tenant's email signature (Settings → Email Templates → Signature),
// added to every templated email. Client-safe.

export interface SignatureTenant {
  name: string
  trading_name: string | null
  email_signature: string | null
  email_signature_image_path: string | null
  email_signature_image_width: number | null
  email_signature_image_height: number | null
}

/** Signature logo size limits (px, as shown in the email). */
export const SIGNATURE_IMAGE_MIN_WIDTH = 60
export const SIGNATURE_IMAGE_MAX_WIDTH = 400
export const SIGNATURE_IMAGE_DEFAULT_WIDTH = 180

/** Public URL of a file in the tenant-assets bucket (logos, signature image). */
export function tenantAssetUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!path || !base) return null
  return `${base}/storage/v1/object/public/tenant-assets/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function emailSignatureFor(tenant: SignatureTenant): EmailSignature | null {
  const html = tenant.email_signature?.trim() ? toRichHtml(tenant.email_signature) : ''
  // The plain-text version leaves out the logo's line
  const text = html
    ? richToText(html).split('\n').filter(line => line.trim() !== SIGNATURE_LOGO_TOKEN).join('\n').replace(/^\n+|\n+$/g, '')
    : ''
  const url = tenantAssetUrl(tenant.email_signature_image_path)
  const width = tenant.email_signature_image_width
  const height = tenant.email_signature_image_height
  const image = url && width && height
    ? { url, width, height, alt: tenant.trading_name || tenant.name }
    : null
  if (!text.trim() && !image) return null
  return { html: text.trim() ? html : '', text, image }
}

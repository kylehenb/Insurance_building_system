// Settings for the e-signing module. Safe to import from client components.

/** Days a signing link stays valid after it is sent (or resent). */
export const DEFAULT_EXPIRY_DAYS = 14

/**
 * Grace period after expiry for a signer who opened the link before it
 * expired, so nobody is cut off part-way through signing.
 */
export const SUBMIT_GRACE_HOURS = 24

/** Private Supabase Storage bucket for source and signed PDFs. */
export const SIGNED_DOCUMENTS_BUCKET = 'signed-documents'

/** Contact line shown on every signer screen. */
export const SIGNER_CONTACT = {
  email: 'office@insurancerepairco.com.au',
  phone: '0431 132 077',
  phoneHref: 'tel:+61431132077',
} as const

/**
 * WA Home Building Contracts Act 1991: work valued over $7,500 needs a
 * building contract. At or under it, a Scope of Works Authorisation is used.
 * Only used to suggest the document type; the office can override it.
 */
export const BUILDING_CONTRACT_THRESHOLD = 7500

/** Shown on the signer page right above the Finish button. */
export const CONSENT_TEXT = 'By tapping Finish you agree to sign this document electronically.'

/** Rate limits for the public signing routes (fixed windows). */
export const RATE_LIMITS = {
  /** Page loads and PDF opens, per IP */
  viewPerIp: { max: 60, windowSeconds: 10 * 60 },
  /** Signature submissions, per IP */
  submitPerIp: { max: 10, windowSeconds: 10 * 60 },
  /** Signature submissions, per link */
  submitPerToken: { max: 5, windowSeconds: 10 * 60 },
} as const

/** Automatic reminders (daily cron: /api/signing/reminders). Off per request via reminders_enabled. */
export const REMINDER_DEFAULTS = {
  /** Remind when a request has been waiting this many days since sent / last reminder */
  afterDays: 7,
  /** Stop reminding after this many reminders */
  maxReminders: 3,
} as const

/** Where the signing link points. */
// A Vercel preview links to itself, so a test request sent from a preview is
// signed on that same preview (NEXT_PUBLIC_APP_URL points at production).
export function appBaseUrl(): string {
  if (process.env.VERCEL_ENV === 'preview') {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
    if (previewHost) return `https://${previewHost}`
  }
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export function signingLinkFor(token: string): string {
  return `${appBaseUrl()}/sign/${token}`
}

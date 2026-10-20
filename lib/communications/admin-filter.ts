// Classifies inbound mail that is clearly NOT about a specific job
// (SaaS notifications, panel compliance reminders, newsletters, auto-replies).
//
// Only applied AFTER job matching has found nothing — a job-related email
// from any of these senders still links normally. Matching emails are stored
// with source = 'admin' and hidden from the unlinked inbox by default, not
// deleted.

// Sender domains (suffix match) that never carry job correspondence.
const ADMIN_DOMAINS = [
  'docusign.net',
  'docusign.com',
  'google.com',
  'cloudflare.com',
  'xero.com',
  'myob.com',
  'zoho.com',
  'zoho-books.com.au',
  'zohobooks.com',
  'linkedin.com',
  'facebookmail.com',
  'microsoft.com',
  'vercel.com',
  'github.com',
  'supabase.com',
  'supabase.io',
  'stripe.com',
  'paypal.com',
  'paypal.com.au',
  'intuit.com',
  'mailchimp.com',
  'canva.com',
  'zapier.com',
  'reckon.com',
  'bizcover.com.au',
]

// Local parts of automated / bulk senders ("welcome_donotreply", "NO-REPLY2", "payments-noreply").
const ADMIN_LOCAL_PART_RE = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster)|^(bounces?|notifications?|marketing|events|publications|communications|newsletters?)([+._-]|$)/i

const ADMIN_SUBJECT_PATTERNS: RegExp[] = [
  /^\s*(automatic reply|auto[- ]?reply|out of (the )?office)\b/i,
  /\bnewsletter\b/i,
  /\bcode of conduct\b/i,
  /\bsafety alert\b/i,
  /\b(licen[cs]e|insurance|workers'? ?comp\w*|work ?cover|\bwc)\b.*\b(expir\w*|update required|renew\w*)\b/i,
  /\b(expir\w*|renew\w*)\b.*\b(licen[cs]e|insurance|workers'? ?comp\w*|work ?cover)\b/i,
  /\battestation\b/i,
  /\b(payment advice|remittance advice)\b/i,
  /\bcontractor rates\b/i,
  /\b(webinar|unsubscribe)\b/i,
  /\brenewed agreement\b/i,
  /\bhow (was|were|are|is|did) (your|you|we)\b/i,
  /\b(panel discussion|consultation)\b/i,
  /\b(certificate of currency|policy schedule|policy documents?)\b/i,
  /\bmentioned you in a comment\b/i,
  /\b(two-factor|verification code|security alert)\b/i,
]

export function isAdminEmail(params: {
  fromEmail: string
  subject: string
  body?: string
}): boolean {
  const email = params.fromEmail.toLowerCase().trim()
  const [local = '', domain = ''] = email.split('@')

  if (ADMIN_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) return true
  if (ADMIN_LOCAL_PART_RE.test(local)) return true
  if (ADMIN_SUBJECT_PATTERNS.some(re => re.test(params.subject))) return true

  // Bulk mail: an unsubscribe link in the body
  if (params.body && /\bunsubscribe\b/i.test(params.body)) return true

  return false
}

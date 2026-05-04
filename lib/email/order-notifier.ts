import { getGmailClient } from '@/lib/gmail/client'
import type { ParsedOrderResult } from './order-parser'
import type { ExtractedMessage } from '@/lib/gmail/messages'

const OFFICE_EMAIL = 'office@insurancerepairco.com.au'
const IRC_MASTER_URL = 'https://insurance-building-system.vercel.app/dashboard/insurer-orders'

function isWithinBusinessHours(): boolean {
  // Perth WA — UTC+8
  const perthNow = new Date(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth' }))
  const day = perthNow.getDay()
  const hour = perthNow.getHours()
  // Mon–Fri (1–5), 7am–6pm
  return day >= 1 && day <= 5 && hour >= 7 && hour < 18
}

function buildEmailRaw(subject: string, body: string): string {
  const lines = [
    `From: ${OFFICE_EMAIL}`,
    `To: ${OFFICE_EMAIL}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ]
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

export async function sendOrderNotification(
  orderId: string,
  parsed: ParsedOrderResult,
  message: ExtractedMessage
): Promise<void> {
  const isNeedsReview = parsed.parseStatus === 'needs_review'
  const inBusinessHours = isWithinBusinessHours()

  // Skip success notifications outside business hours
  if (!isNeedsReview && !inBusinessHours) return

  const { data } = parsed
  const claimNum = data.claim_number || 'No claim number'
  const insuredName = data.insured_name || 'Unknown'

  const subject = isNeedsReview
    ? `⚠️ Order needs review — ${message.subject}`
    : `✅ Order parsed — ${claimNum} — ${insuredName}`

  const confidencePct = Math.round(parsed.confidence * 100)
  const missingStr = parsed.missingFields.length > 0 ? parsed.missingFields.join(', ') : 'None'

  const body = [
    `Insurer: ${parsed.insurerDetected ?? data.insurer ?? '—'}`,
    `Claim: ${claimNum}`,
    `Insured: ${insuredName}`,
    `Address: ${data.property_address ?? '—'}`,
    `Work type: ${data.wo_type ?? '—'}`,
    `Confidence: ${confidencePct}%`,
    `Parse status: ${parsed.parseStatus}`,
    `Missing fields: ${missingStr}`,
    '',
    `View in IRC Master: ${IRC_MASTER_URL}`,
  ].join('\n')

  try {
    const gmail = getGmailClient()
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmailRaw(subject, body),
      },
    })
  } catch (err) {
    console.error('[order-notifier] send error:', err)
  }
}

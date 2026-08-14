import { createClient as createRawClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw } from './build-raw'
import type { ParsedOrderResult } from './order-parser'
import type { ExtractedMessage } from '@/lib/gmail/messages'

const OFFICE_EMAIL = 'office@insurancerepairco.com.au'
const IRC_MASTER_URL = 'https://insurance-building-system.vercel.app/dashboard/insurer-orders'

type AutoJobLodgerConfig = {
  notification_enabled: boolean
  notification_email: string
  notify_on_success: boolean
  notify_on_needs_review: boolean
  notify_outside_business_hours: boolean
  notification_subject_success: string
  notification_subject_review: string
  notification_body_template: string
}

function isWithinBusinessHours(): boolean {
  // Perth WA — UTC+8
  const perthNow = new Date(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth' }))
  const day = perthNow.getDay()
  const hour = perthNow.getHours()
  // Mon–Fri (1–5), 7am–6pm
  return day >= 1 && day <= 5 && hour >= 7 && hour < 18
}

function replaceTokens(template: string, tokens: Record<string, string>): string {
  let result = template
  for (const [token, value] of Object.entries(tokens)) {
    result = result.split(token).join(value)
  }
  return result
}

async function fetchConfig(tenantId: string): Promise<AutoJobLodgerConfig | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null

  try {
    const client = createRawClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await client
      .from('auto_job_lodger_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .single()

    if (error || !data) return null
    return data as AutoJobLodgerConfig
  } catch {
    return null
  }
}

const DEFAULT_BODY_TEMPLATE = [
  'Insurer: {insurer}',
  'Claim: {claim_number}',
  'Insured: {insured_name}',
  'Address: {property_address}',
  'Work type: {work_order_type}',
  'Confidence: {confidence}%',
  'Parse status: {parse_status}',
  'Missing fields: {missing_fields}',
  '',
  `View in IRC Master: ${IRC_MASTER_URL}`,
].join('\n')

export async function sendOrderNotification(
  orderId: string,
  parsed: ParsedOrderResult,
  message: ExtractedMessage,
  tenantId: string
): Promise<void> {
  const isNeedsReview = parsed.parseStatus === 'needs_review'
  const inBusinessHours = isWithinBusinessHours()
  const { data } = parsed

  const config = await fetchConfig(tenantId)

  if (config !== null) {
    // Config-driven notification logic
    if (!config.notification_enabled) return
    if (!isNeedsReview && !config.notify_on_success) return
    if (isNeedsReview && !config.notify_on_needs_review) return
    if (!isNeedsReview && !config.notify_outside_business_hours && !inBusinessHours) return

    const email = config.notification_email

    const subjectTokens: Record<string, string> = {
      '{claim_number}': data.claim_number || 'No claim number',
      '{insured_name}': data.insured_name || 'Unknown',
      '{original_subject}': message.subject || '',
    }

    const subjectTemplate = isNeedsReview
      ? config.notification_subject_review
      : config.notification_subject_success

    const subject = replaceTokens(subjectTemplate, subjectTokens)

    const bodyTokens: Record<string, string> = {
      '{insurer}': parsed.insurerDetected ?? data.insurer ?? '—',
      '{claim_number}': data.claim_number || 'No claim number',
      '{insured_name}': data.insured_name || 'Unknown',
      '{property_address}': data.property_address ?? '—',
      '{work_order_type}': data.wo_type ?? '—',
      '{confidence}': Math.round(parsed.confidence * 100).toString(),
      '{parse_status}': parsed.parseStatus,
      '{missing_fields}': parsed.missingFields.length > 0 ? parsed.missingFields.join(', ') : 'None',
    }

    const body = replaceTokens(config.notification_body_template, bodyTokens)

    try {
      const gmail = getGmailClient()
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: buildEmailRaw({ from: email, to: email, subject, body }),
        },
      })
    } catch (err) {
      console.error('[order-notifier] send error:', err)
    }

    return
  }

  // Fallback: hardcoded behaviour (no config found)
  if (!isNeedsReview && !inBusinessHours) return

  const claimNum = data.claim_number || 'No claim number'
  const insuredName = data.insured_name || 'Unknown'

  const subject = isNeedsReview
    ? `⚠️ Order needs review — ${message.subject}`
    : `✅ Order parsed — ${claimNum} — ${insuredName}`

  const bodyTokens: Record<string, string> = {
    '{insurer}': parsed.insurerDetected ?? data.insurer ?? '—',
    '{claim_number}': claimNum,
    '{insured_name}': insuredName,
    '{property_address}': data.property_address ?? '—',
    '{work_order_type}': data.wo_type ?? '—',
    '{confidence}': Math.round(parsed.confidence * 100).toString(),
    '{parse_status}': parsed.parseStatus,
    '{missing_fields}': parsed.missingFields.length > 0 ? parsed.missingFields.join(', ') : 'None',
  }

  const body = replaceTokens(DEFAULT_BODY_TEMPLATE, bodyTokens)

  try {
    const gmail = getGmailClient()
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmailRaw({ from: OFFICE_EMAIL, to: OFFICE_EMAIL, subject, body }),
      },
    })
  } catch (err) {
    console.error('[order-notifier] send error:', err)
  }
}

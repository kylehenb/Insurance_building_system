import { createClient as createRawClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw } from './build-raw'

const OFFICE_EMAIL = 'office@insurancerepairco.com.au'
const DEFAULT_APP_URL = 'https://insurance-building-system.vercel.app'

async function resolveNotificationEmail(tenantId: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return OFFICE_EMAIL

  try {
    const client = createRawClient(supabaseUrl, serviceRoleKey)
    const { data } = await client
      .from('auto_job_lodger_config')
      .select('notification_email')
      .eq('tenant_id', tenantId)
      .single()
    return data?.notification_email || OFFICE_EMAIL
  } catch {
    return OFFICE_EMAIL
  }
}

/**
 * Sent once a pre-lodged order is approved into a real job. Subject carries the job number,
 * address, and insured name so it's searchable from a phone inbox; body links straight into
 * the field app for an unscheduled on-site visit (falls back to the job page when no
 * inspection exists yet for this work order type).
 */
export async function notifyJobApproved({
  tenantId,
  jobId,
  jobNumber,
  propertyAddress,
  insuredName,
  inspectionId,
}: {
  tenantId: string
  jobId: string
  jobNumber: string
  propertyAddress: string | null
  insuredName: string | null
  inspectionId: string | null
}): Promise<void> {
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL
  const actionLink = inspectionId
    ? `${appBaseUrl}/field/${inspectionId}`
    : `${appBaseUrl}/dashboard/jobs/${jobId}`
  const actionLabel = inspectionId ? 'Open in the field app' : 'Open the job'

  const subject = [jobNumber, propertyAddress, insuredName].filter(Boolean).join(' — ')

  const body = [
    `Job ${jobNumber} has been lodged and approved.`,
    '',
    `Insured: ${insuredName ?? '—'}`,
    `Address: ${propertyAddress ?? '—'}`,
    '',
    `${actionLabel}: ${actionLink}`,
  ].join('\n')

  const email = await resolveNotificationEmail(tenantId)

  try {
    const gmail = getGmailClient()
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmailRaw({ from: email, to: email, subject, body }),
      },
    })
  } catch (err) {
    console.error('[notify-job-approved] send error:', err)
  }
}

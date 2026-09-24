import { createServiceClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw } from './build-raw'

const OFFICE_EMAIL = 'office@insurancerepairco.com.au'

export async function notifySubmissionFailure({
  inspectionId,
  inspectorId,
  jobId,
  errors,
}: {
  inspectionId: string
  inspectorId: string | null
  jobId: string | null
  errors: string[]
}): Promise<void> {
  const service = createServiceClient()

  if (!inspectorId) {
    console.error(`[notify-submission-failure] no inspector_id for inspection ${inspectionId}`)
    return
  }

  const { data: authUser } = await service.auth.admin.getUserById(inspectorId)
  const inspectorEmail = authUser?.user?.email
  if (!inspectorEmail) {
    console.error(`[notify-submission-failure] no email found for inspector ${inspectorId}`)
    return
  }

  let jobLabel = `inspection ${inspectionId}`
  if (jobId) {
    const { data: job } = await service
      .from('jobs')
      .select('job_number, property_address')
      .eq('id', jobId)
      .single()
    if (job) {
      jobLabel = [job.job_number, job.property_address].filter(Boolean).join(' — ') || jobLabel
    }
  }

  const subject = `Action needed: field report submission issue (${jobLabel})`
  const body = [
    'Hi,',
    '',
    `Your field inspection was submitted, but part of the automated processing for ${jobLabel} did not finish successfully:`,
    '',
    ...errors.map(e => `- ${e}`),
    '',
    'Please check the inspection in the office system and complete or fix the affected part manually.',
    '',
    '(This is an automated message.)',
  ].join('\n')

  try {
    const gmail = getGmailClient()
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmailRaw({ from: OFFICE_EMAIL, to: inspectorEmail, subject, body }),
      },
    })
  } catch (err) {
    console.error('[notify-submission-failure] send error:', err)
  }
}

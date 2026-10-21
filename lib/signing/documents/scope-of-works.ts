import { buildScopeOfWorksPdf, scopeOfWorksReference } from '@/lib/documents/scope-of-works-pdf'
import { SOW_AGREEMENT, SOW_CONDITIONS, SOW_DECLARATION, SOW_MARKERS } from '@/lib/documents/sow-html'
import { formatSigningDate } from '@/lib/signing/format'
import type { DisplayBlock } from '@/lib/signing/types'
import { detailRows, excessLabel, scopeBlock } from './display-helpers'
import { SIGNING_DOCUMENT_CATALOG } from './catalog'
import type { SigningDocumentType } from './types'

// Scope of Works Authorisation — work valued at $7,500 or less.
// One signature: the owner/insured's authorisation, with printed name and date.

export const scopeOfWorksDocument: SigningDocumentType = {
  key: 'scope_of_works',
  label: SIGNING_DOCUMENT_CATALOG.scope_of_works.label,
  description: SIGNING_DOCUMENT_CATALOG.scope_of_works.description,
  jobSignoff: 'homeowner_signoff',
  stages: { awaiting: 'awaiting_signed_document', afterSigning: 'signed_build_schedule' },
  fields: [
    {
      id: 'owner_authorisation',
      label: 'Authorise the works',
      signature: { anchor: SOW_MARKERS.ownerSignature },
      name: { anchor: SOW_MARKERS.ownerName },
      date: { anchor: SOW_MARKERS.ownerDate },
    },
  ],

  async generate(ctx, { jobId, quoteIds }) {
    const { pdf, filename, data } = await buildScopeOfWorksPdf(jobId, quoteIds, ctx, {
      signingMarkers: true,
      requireApproved: true,
    })
    const { job } = data

    const display: DisplayBlock[] = [
      { type: 'heading', text: 'Scope of Works' },
      {
        type: 'details',
        rows: detailRows([
          { label: 'Property', value: job.property_address },
          { label: 'Authorised for', value: job.insured_name },
          { label: 'Insurer', value: job.insurer },
          { label: 'Claim number', value: job.claim_number },
          { label: 'Job number', value: job.job_number },
          { label: 'Reference', value: scopeOfWorksReference(data) },
          { label: 'Document date', value: formatSigningDate(new Date()) },
        ]),
      },
      { type: 'heading', text: 'Agreement' },
      { type: 'paragraph', text: SOW_AGREEMENT },
      {
        type: 'details',
        rows: [
          { label: 'Works start and how long they take', value: 'Subject to scheduling' },
          { label: 'Excess payable to IRC', value: excessLabel(job.excess) },
        ],
      },
      { type: 'heading', text: 'Approved scope of works' },
      scopeBlock(data),
      { type: 'heading', text: 'Conditions of works' },
      { type: 'list', items: SOW_CONDITIONS, ordered: true },
      { type: 'heading', text: 'Your authorisation' },
      { type: 'paragraph', text: SOW_DECLARATION, emphasis: true },
      {
        type: 'signature',
        fieldId: 'owner_authorisation',
        label: 'Authorise the works',
        context: 'Sign to authorise Insurance Repair Co to carry out the approved works. Your printed name and today’s date are added for you.',
      },
    ]

    return {
      pdf,
      filename,
      title: `Scope of Works Authorisation — ${job.property_address ?? job.job_number}`,
      display,
      totalInclGst: data.totalInclGst,
    }
  },
}

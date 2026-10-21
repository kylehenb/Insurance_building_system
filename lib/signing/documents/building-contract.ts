import { buildBuildingContractPdf } from '@/lib/documents/building-contract-pdf'
import { BUILDING_CONTRACT_MARKERS } from '@/lib/documents/building-contract-html'
import { combinedQuoteRefLabel } from '@/lib/documents/scope-grouping'
import { formatSigningDate } from '@/lib/signing/format'
import type { DisplayBlock } from '@/lib/signing/types'
import { detailRows, excessLabel, formatAud, scopeBlock } from './display-helpers'
import { SIGNING_DOCUMENT_CATALOG } from './catalog'
import type { SigningDocumentType } from './types'

// Building Contract (WA) — work valued over $7,500.
// Two owner signatures, as on the paper contract:
//   1. Home Building Contracts Act 1991 s.6 — receipt of documents
//   2. The contract signing page
//
// The wording below is copied from lib/documents/building-contract-html.ts.
// lib/signing/__tests__/documents.test.ts fails if the two drift apart.

export const CONTRACT_TEXT = {
  coverIntro: 'We are pleased to advise that your Insurer has instructed Insurance Repair Co to proceed with the insurance repairs at your property.',
  coverRequirement: 'Attached is a Building Contract for your reference, which is a state based requirement for jobs over $7,500 in WA.',
  contractSum: 'Building Works Component inclusive of GST (the Contract Sum) as adjusted in accordance with the Contract, at the times and in the manner specified in the Conditions.',
  priceWarning: 'Warning: The Contract Price may increase in accordance with the contract terms. This is because not all costs can be absolutely determined at the outset, although the Contractor is obliged to make reasonable estimates given known conditions. The reasons for possible increases include:',
  priceReasons: [
    'extra costs incurred by the Contractor in accessing the Site (Refer clause 5.2 of the General Conditions)',
    'the actual cost of prime cost items and work for which provisional sums have been specified exceeding the estimates set out in the contract (Refer clause 7 of the General Conditions)',
    'variations including those required by the council/registered building surveyor (Refer clause 8 of the General Conditions)',
    'extra costs for delay claimed by the Contractor (Refer clauses 5.4 and 9.5 of the General Conditions)',
  ],
  depositNotes: [
    'Deposit limit: 6.5% of the Contract Price',
    'Deposit is payable in accordance with clause 1.3 of the General Conditions and equal to the Excess (Item 3) but not more than the Deposit limit',
    'Each progress claim must not exceed an amount directly related to the progress of Work under the Contract',
  ],
  excludedIntro: 'Unless otherwise stated elsewhere in the Contract, the following items are not part of the Works and are excluded from the Contract and not included in the Contract Price:',
  excludedItems: 'Warranty or liability in respect of any nature on any work not actually performed by the Contractor, any work in whole or in part that is carried out by the Owner or others (prior to, during or after the Contract); survey of the property; the cost of overcoming any Latent Condition, and any other excluded items shown hereunder:',
  importantNotices: [
    'Do not sign this Contract unless you have read and understand the clauses as well as the notes and explanations contained in this document.',
    'Both the Contractor and the Owner should retain an identical signed copy of this Contract including the drawings, specifications and other attached documents.',
    'Make sure that you initial all attached documents and any amendments or deletions to the Contract.',
  ],
  part3a: 'The Contractor must provide the Owner with a certificate of insurance under Part 3A of the Home Building Contracts Act 1991 before the Contractor commences work and before the Contractor can request or receive any payment.',
  section6Intro: 'Under section 6 of the Home Building Contracts Act 1991 (the Act), the Owner acknowledges receipt of the following documents:',
  section6Notice: 'Attached notice of explanation of the relevant provisions of the Act, prescribed under section 4 (2) (Schedule, pages 12-13).',
} as const

export const buildingContractDocument: SigningDocumentType = {
  key: 'building_contract',
  label: SIGNING_DOCUMENT_CATALOG.building_contract.label,
  description: SIGNING_DOCUMENT_CATALOG.building_contract.description,
  jobSignoff: 'homeowner_signoff',
  stages: { awaiting: 'awaiting_signed_document', afterSigning: 'signed_build_schedule' },
  fields: [
    {
      id: 'receipt_of_documents',
      label: 'Receipt of documents',
      signature: { anchor: BUILDING_CONTRACT_MARKERS.receiptSignature },
      date: { anchor: BUILDING_CONTRACT_MARKERS.receiptDate },
    },
    {
      id: 'owner_signature',
      label: 'Sign the contract',
      signature: { anchor: BUILDING_CONTRACT_MARKERS.ownerSignature },
      date: { anchor: BUILDING_CONTRACT_MARKERS.ownerDate },
      name: { anchor: BUILDING_CONTRACT_MARKERS.ownerSignedBy },
      representative: { anchor: BUILDING_CONTRACT_MARKERS.ownerRepresentative },
    },
  ],

  async generate(ctx, { jobId, quoteIds }) {
    const { pdf, filename, data } = await buildBuildingContractPdf(jobId, quoteIds, ctx, {
      signingMarkers: true,
      requireApproved: true,
    })
    const { job } = data
    const contractDate = formatSigningDate(new Date())
    const price = formatAud(data.totalInclGst)

    const display: DisplayBlock[] = [
      { type: 'heading', text: 'Building Contract' },
      { type: 'paragraph', text: CONTRACT_TEXT.coverIntro },
      { type: 'paragraph', text: CONTRACT_TEXT.coverRequirement },
      {
        type: 'details',
        rows: detailRows([
          { label: 'Owner', value: job.insured_name },
          { label: 'Property', value: job.property_address },
          { label: 'Contractor', value: 'Insurance Repair Co Pty Ltd (ABN 12 686 067 881, WA Licence BC105884)' },
          { label: 'Insurer', value: job.insurer },
          { label: 'Claim number', value: job.claim_number },
          { label: 'Job number', value: job.job_number },
          { label: 'Quote reference', value: combinedQuoteRefLabel(data.quotes) },
          { label: 'Contract date', value: contractDate },
        ]),
      },
      { type: 'heading', text: 'Price and excess' },
      {
        type: 'details',
        rows: [
          { label: 'Estimated contract price (incl GST)', value: price },
          { label: 'Excess', value: excessLabel(job.excess) },
          { label: 'Progress payments', value: 'No' },
          { label: 'Work period', value: 'To be confirmed (calendar days, including delays allowance)' },
          { label: 'Date for commencement', value: 'To be determined under Clause 7 of the General Conditions' },
        ],
      },
      { type: 'paragraph', text: CONTRACT_TEXT.contractSum },
      { type: 'paragraph', text: CONTRACT_TEXT.priceWarning, emphasis: true },
      { type: 'list', items: [...CONTRACT_TEXT.priceReasons] },
      { type: 'list', items: [...CONTRACT_TEXT.depositNotes] },
      { type: 'heading', text: 'The works' },
      { type: 'paragraph', text: 'In accordance with the Contractor’s Scope of Works approved by the Insurer:' },
      scopeBlock(data),
      { type: 'heading', text: 'Excluded items' },
      { type: 'paragraph', text: CONTRACT_TEXT.excludedIntro },
      { type: 'paragraph', text: CONTRACT_TEXT.excludedItems },
      { type: 'paragraph', text: 'N/A — refer to the scope of works for what is included.' },
      { type: 'heading', text: 'Important notices' },
      { type: 'list', items: [...CONTRACT_TEXT.importantNotices] },
      { type: 'paragraph', text: CONTRACT_TEXT.part3a },
      { type: 'heading', text: 'Receipt of documents (section 6)' },
      { type: 'paragraph', text: CONTRACT_TEXT.section6Intro },
      {
        type: 'list',
        ordered: true,
        items: [CONTRACT_TEXT.section6Notice, `A signed copy of the Building Contract dated: ${contractDate}`],
      },
      {
        type: 'signature',
        fieldId: 'receipt_of_documents',
        label: 'Receipt of documents',
        context: 'Sign to confirm you have received the documents listed above.',
      },
      { type: 'heading', text: 'Signing the contract' },
      {
        type: 'details',
        rows: [
          { label: 'Contractor', value: `Insurance Repair Co Pty Ltd — signed by Kyle Bindon on ${contractDate}` },
          { label: 'Owner', value: job.insured_name ?? '—' },
        ],
      },
      {
        type: 'signature',
        fieldId: 'owner_signature',
        label: 'Sign the contract',
        context: 'Sign as the owner to enter into this Building Contract. Today’s date is added for you.',
      },
    ]

    return {
      pdf,
      filename,
      title: `Building Contract — ${job.property_address ?? job.job_number}`,
      display,
      totalInclGst: data.totalInclGst,
    }
  },
}

import type { QuoteDocumentContext } from '@/lib/documents/quote-document-data'
import type { SignatureFieldConfig } from '@/lib/signing/pdf/locate-fields'
import type { DisplayBlock, SigningDocumentTypeKey } from '@/lib/signing/types'

/** What a document type produces for a new signing request. */
export interface GeneratedSigningDocument {
  /** PDF with field markers in place (located and removed by the caller) */
  pdf: Buffer
  filename: string
  /** e.g. "Scope of Works Authorisation — 12 Smith St, Perth" */
  title: string
  /** Large-text reading view for the signer's phone */
  display: DisplayBlock[]
  /** Contract price incl GST across the quotes, for the record */
  totalInclGst: number
}

export interface SigningDocumentType {
  key: SigningDocumentTypeKey
  /** Short name, e.g. "Scope of Works Authorisation" */
  label: string
  /** One line for the office, shown in the send dialog */
  description: string
  /** Which jobs.* sign-off fields this document updates */
  jobSignoff: 'homeowner_signoff'
  /** Job stage this document belongs to, and the stage the office can confirm after signing */
  stages: { awaiting: 'awaiting_signed_document'; afterSigning: 'signed_build_schedule' }
  /** Signature fields, in the order the signer is taken through them */
  fields: SignatureFieldConfig[]
  /** Builds the PDF (with field markers) and the reading view from the job's quotes */
  generate(ctx: QuoteDocumentContext, params: { jobId: string; quoteIds: string[] }): Promise<GeneratedSigningDocument>
}

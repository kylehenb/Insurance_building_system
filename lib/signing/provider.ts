import type { SigningDocumentTypeKey, SigningRequestSummary } from './types'

// The boundary between IRC Master and whatever collects signatures.
//
// Everything outside lib/signing (the job page UI, the API routes) goes
// through getSigningProvider() or the provider-neutral functions in
// lib/signing/service.ts. Today the only implementation is in-house
// (lib/signing/in-house). A hosted provider (e.g. Documenso) would implement
// this same interface, keep using signing_requests / signing_events as the
// local record, and call recordSignedDocument() (lib/signing/completion.ts)
// from its webhook — no UI changes needed.

export interface SigningActor {
  tenantId: string
  /** Office user doing this; null for system jobs (reminders) */
  userId: string | null
}

export interface CreateSigningRequestInput {
  jobId: string
  documentType: SigningDocumentTypeKey
  quoteIds: string[]
  signer: {
    name: string
    email: string
    phone?: string | null
  }
  /** Automatic reminders every 7 days (max 3). Default on. */
  remindersEnabled?: boolean
}

export interface SendSigningRequestOptions {
  /** Send again with a fresh link (the previous link stops working) */
  resend?: boolean
  /** Reminder wording; implies a fresh link like resend */
  reminder?: boolean
}

export interface SignedDocument {
  pdf: Buffer
  filename: string
  sha256: string | null
}

export interface SigningProvider {
  readonly id: string
  /** Generates the document and records a draft request. Nothing is sent. */
  createRequest(actor: SigningActor, input: CreateSigningRequestInput): Promise<SigningRequestSummary>
  /** Issues a signing link and delivers it to the signer. */
  send(actor: SigningActor, requestId: string, options?: SendSigningRequestOptions): Promise<SigningRequestSummary>
  getStatus(actor: SigningActor, requestId: string): Promise<SigningRequestSummary>
  /** The signed PDF (with its certificate), or null if not signed yet. */
  getSignedDocument(actor: SigningActor, requestId: string): Promise<SignedDocument | null>
  /** Stops the link working. Signed requests can't be revoked. */
  revoke(actor: SigningActor, requestId: string, reason?: string | null): Promise<SigningRequestSummary>
}

export class SigningError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 410 | 422 | 429 | 500 | 502) {
    super(message)
    this.name = 'SigningError'
  }
}

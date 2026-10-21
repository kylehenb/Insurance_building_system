import type { Database } from '@/lib/supabase/database.types'

// Shared types for the e-signing module. Safe to import from client
// components: no server-only code here.

export type SigningRequestRow = Database['public']['Tables']['signing_requests']['Row']
export type SigningEventRow = Database['public']['Tables']['signing_events']['Row']

export type SigningStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'expired' | 'revoked'

export const SIGNING_STATUSES: SigningStatus[] = ['draft', 'sent', 'viewed', 'signed', 'expired', 'revoked']

export type SigningDocumentTypeKey = 'scope_of_works' | 'building_contract'

export type SignatureMethod = 'typed' | 'drawn'

/** Who is signing, chosen by the signer on the signing page. */
export type SignerCapacity = 'owner' | 'joint_owner' | 'authorised_person'

export const SIGNER_CAPACITY_LABELS: Record<SignerCapacity, string> = {
  owner: 'Owner',
  joint_owner: 'Joint owner',
  authorised_person: 'Authorised person signing for the owner',
}

/**
 * The name as printed beside a signature: "Jane Citizen", "Jane Citizen
 * (joint owner)" or "John Smith for Alex Example".
 */
export function printedSignerName(name: string, capacity: SignerCapacity | null | undefined, ownerName: string | null | undefined): string {
  if (capacity === 'joint_owner') return `${name} (joint owner)`
  if (capacity === 'authorised_person') return ownerName ? `${name} for ${ownerName}` : `${name} (authorised person)`
  return name
}

export type SigningEventType =
  | 'created'
  | 'sent'
  | 'resent'
  | 'send_failed'
  | 'viewed'
  | 'document_opened'
  | 'signed'
  | 'sign_failed'
  | 'signed_copy_sent'
  | 'revoked'
  | 'expired'
  | 'reminded'
  | 'stage_confirmed'
  | 'rate_limited'
  | 'reminders_on'
  | 'reminders_off'

/** A rectangle on a PDF page, in PDF points from the bottom-left corner. */
export interface PdfRect {
  /** 0-based page index */
  page: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * A signature field located in a generated PDF. Stored on the request
 * (signing_requests.fields) when it is created.
 */
export interface LocatedSignatureField {
  id: string
  /** Step label shown to the signer, e.g. "Receipt of documents" */
  label: string
  signature: PdfRect
  /** Where the signing date is written, if the document has a date blank */
  date: PdfRect | null
  /** Where the signer's printed name is written, if the document has one */
  name: PdfRect | null
  /** Owner's representative blank, filled only when an authorised person signs (older requests: absent) */
  representative?: PdfRect | null
}

// ── Mobile reading view ─────────────────────────────────────────────────────
// The signer reads the document as large, reflowed text on their phone
// (no pinch-zoom), built from the same data as the PDF. The exact PDF is
// always one tap away.

export type DisplayBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string; emphasis?: boolean }
  | { type: 'details'; rows: { label: string; value: string }[] }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'scope'; rooms: { room: string; items: { description: string; qty: string }[] }[] }
  | { type: 'signature'; fieldId: string; label: string; context: string }

/** What the office UI shows for a request (no token, no internals). */
export interface SigningRequestSummary {
  id: string
  jobId: string
  documentType: string
  documentTitle: string
  status: SigningStatus
  signerName: string
  signerEmail: string | null
  signerPhone: string | null
  expiresAt: string | null
  sentAt: string | null
  viewedAt: string | null
  signedAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  reminderCount: number
  lastRemindedAt: string | null
  remindersEnabled: boolean
  /** Name the signer confirmed when signing, and in what capacity */
  signedName: string | null
  signerCapacity: SignerCapacity | null
  hasSignedDocument: boolean
  signedJobFileId: string | null
  stageConfirmedAt: string | null
  createdAt: string
  quoteIds: string[]
}

export interface SigningEventSummary {
  id: string
  event: string
  createdAt: string
  ip: string | null
  userAgent: string | null
  actorId: string | null
  metadata: Record<string, unknown>
}

/** Effective status: an open request past its expiry reads as expired. */
export function effectiveStatus(row: Pick<SigningRequestRow, 'status' | 'expires_at'>, now = new Date()): SigningStatus {
  const status = row.status as SigningStatus
  if ((status === 'sent' || status === 'viewed') && row.expires_at && new Date(row.expires_at) <= now) {
    return 'expired'
  }
  return status
}

export function toSigningRequestSummary(row: SigningRequestRow, now = new Date()): SigningRequestSummary {
  return {
    id: row.id,
    jobId: row.job_id,
    documentType: row.document_type,
    documentTitle: row.document_title,
    status: effectiveStatus(row, now),
    signerName: row.signer_name,
    signerEmail: row.signer_email,
    signerPhone: row.signer_phone,
    expiresAt: row.expires_at,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    signedAt: row.signed_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    reminderCount: row.reminder_count,
    lastRemindedAt: row.last_reminded_at,
    remindersEnabled: row.reminders_enabled,
    signedName: row.signed_name,
    signerCapacity: (row.signer_capacity as SignerCapacity | null) ?? null,
    hasSignedDocument: !!row.signed_pdf_path,
    signedJobFileId: row.signed_job_file_id,
    stageConfirmedAt: row.stage_confirmed_at,
    createdAt: row.created_at,
    quoteIds: row.quote_ids ?? [],
  }
}

export function toSigningEventSummary(row: SigningEventRow): SigningEventSummary {
  return {
    id: row.id,
    event: row.event,
    createdAt: row.created_at,
    ip: row.ip,
    userAgent: row.user_agent,
    actorId: row.actor_id,
    metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata
      : {}) as Record<string, unknown>,
  }
}

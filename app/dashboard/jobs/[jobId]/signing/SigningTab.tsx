'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Download, FileText, PenLine, RotateCw, Send, XCircle } from 'lucide-react'
import { formatPerthDateTime, formatSigningDate } from '@/lib/signing/format'
import type { SigningRequestSummary } from '@/lib/signing/types'
import { documentUrl } from './api'
import { SendForSignatureDialog } from './SendForSignatureDialog'
import { SigningAuditTrail } from './SigningAuditTrail'
import { SigningStatusBadge } from './SigningStatusBadge'
import { useJobSigning } from './useJobSigning'

// Signatures tab on the job page: send documents for signature and follow
// each request (sent → viewed → signed), with resend, revoke, downloads and
// the audit trail.

function when(value: string | null) {
  return value ? formatPerthDateTime(value) : '—'
}

function RequestRow({
  request,
  busy,
  onAction,
}: {
  request: SigningRequestSummary
  busy: boolean
  onAction: (action: 'send' | 'resend' | 'revoke') => void
}) {
  const [open, setOpen] = useState(false)
  const canResend = request.status === 'sent' || request.status === 'viewed' || request.status === 'expired'
  const canRevoke = request.status !== 'signed' && request.status !== 'revoked'
  const btn = 'inline-flex items-center gap-1.5 rounded-md border border-[#e0dbd4] bg-white px-2.5 py-1.5 text-[12px] text-[#3a3530] hover:bg-[#f5f2ee] disabled:opacity-50'

  return (
    <div className="rounded-lg border border-[#e0dbd4] bg-white">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#9e998f]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-[#1a1a1a]">{request.documentTitle}</span>
            <SigningStatusBadge status={request.status} />
          </div>
          <div className="mt-0.5 text-[12px] text-[#7a7268]">
            {request.signerName} · {request.signerEmail ?? request.signerPhone ?? '—'}
          </div>
          <div className="mt-1 text-[12px] text-[#9e998f]">
            {request.status === 'signed' && <>Signed {when(request.signedAt)}</>}
            {(request.status === 'sent' || request.status === 'viewed') && (
              <>
                Sent {when(request.sentAt)}
                {request.viewedAt && <> · Opened {when(request.viewedAt)}</>}
                {request.expiresAt && <> · Link valid until {formatSigningDate(request.expiresAt)}</>}
                {request.reminderCount > 0 && <> · {request.reminderCount} reminder{request.reminderCount > 1 ? 's' : ''}</>}
              </>
            )}
            {request.status === 'expired' && <>Link expired {request.expiresAt ? formatSigningDate(request.expiresAt) : ''}. Resend to issue a new link.</>}
            {request.status === 'revoked' && <>Revoked {when(request.revokedAt)}{request.revokedReason ? ` — ${request.revokedReason}` : ''}</>}
            {request.status === 'draft' && <>Created {when(request.createdAt)} but not sent.</>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {request.status === 'draft' && (
            <button className={btn} disabled={busy} onClick={() => onAction('send')}><Send className="h-3.5 w-3.5" /> Send</button>
          )}
          {canResend && (
            <button className={btn} disabled={busy} onClick={() => onAction('resend')} title="Emails a new link. The previous link stops working.">
              <RotateCw className="h-3.5 w-3.5" /> Resend
            </button>
          )}
          {request.hasSignedDocument && (
            <a className={btn} href={documentUrl(request.id, 'signed', true)}><Download className="h-3.5 w-3.5" /> Signed PDF</a>
          )}
          <a className={btn} href={documentUrl(request.id, 'source')} target="_blank" rel="noopener">
            <FileText className="h-3.5 w-3.5" /> {request.status === 'signed' ? 'Unsigned original' : 'Preview'}
          </a>
          {canRevoke && (
            <button className={`${btn} text-[#991b1b]`} disabled={busy} onClick={() => onAction('revoke')}>
              <XCircle className="h-3.5 w-3.5" /> Revoke
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1 border-t border-[#f0ece6] px-4 py-2 text-left text-[12px] text-[#7a7268] hover:bg-[#fafaf9]"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Audit trail
      </button>
      {open && (
        <div className="px-4 pb-4">
          <SigningAuditTrail requestId={request.id} refreshKey={`${request.status}-${request.sentAt}-${request.signedAt}`} />
        </div>
      )}
    </div>
  )
}

export function SigningTab({ jobId }: { jobId: string }) {
  const { requests, defaults, loading, error, busyId, reload, act } = useJobSigning(jobId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const run = async (request: SigningRequestSummary, action: 'send' | 'resend' | 'revoke') => {
    let body: Record<string, unknown> | undefined
    if (action === 'revoke') {
      const reason = window.prompt(`Revoke the signing link for ${request.signerName}? The link will stop working.\n\nReason (optional):`)
      if (reason === null) return
      body = { reason }
    }
    if (action === 'resend' && !window.confirm(`Email ${request.signerEmail} a new link? The previous link will stop working.`)) return
    try {
      await act(request.id, action, body)
      setNotice({ kind: 'ok', text: action === 'revoke' ? 'Signing link revoked.' : `Emailed to ${request.signerEmail}.` })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' })
    }
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1a1a1a]">Signatures</h2>
          <p className="text-[12px] text-[#9e998f]">Homeowners sign by email link on any phone or computer — no account needed.</p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[#1a1a1a] px-4 py-2 text-[13px] font-semibold text-[#c9a96e]"
        >
          <PenLine className="h-4 w-4" /> Send for signature
        </button>
      </div>

      {notice && (
        <div className={`mb-4 rounded-md border px-3 py-2 text-[13px] ${notice.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {notice.text}
        </div>
      )}
      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-[#f5f2ee]" />
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#e0dbd4] px-6 py-10 text-center text-[13px] text-[#9e998f]">
          Nothing has been sent for signature on this job yet.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <RequestRow key={r.id} request={r} busy={busyId === r.id} onAction={action => run(r, action)} />
          ))}
        </div>
      )}

      {dialogOpen && (
        <SendForSignatureDialog
          jobId={jobId}
          defaults={defaults}
          onClose={() => setDialogOpen(false)}
          onSent={message => {
            setDialogOpen(false)
            setNotice({ kind: 'ok', text: message })
            reload()
          }}
        />
      )}
    </div>
  )
}

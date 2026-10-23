'use client'

import { useState } from 'react'
import { formatPerthDateTime } from '@/lib/signing/format'
import { signingDocumentLabel } from '@/lib/signing/documents/catalog'
import { SIGNER_CAPACITY_LABELS } from '@/lib/signing/types'
import { excessInvoiceStatusLine } from '@/lib/excess/decision'
import { documentUrl } from './api'
import { useJobSigning } from './useJobSigning'
import { isPendingApproval } from '@/lib/approvals/client'
import { ApprovalNotice } from '@/components/approvals/approval-notice'

// Action card in the stage banner. When a document has been signed, the job
// stage is NOT moved automatically: this card asks the office to confirm,
// which records the sign-off as received and moves the job to
// "Signed — Build Schedule". Also shows the latest request still out for
// signature, so the banner reflects where things stand.

export function SigningStageCard({ jobId, onConfirmed }: { jobId: string; onConfirmed?: () => void }) {
  const { requests, busyId, act } = useJobSigning(jobId)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const toConfirm = requests.find(r => r.status === 'signed' && !r.stageConfirmedAt)
  const outstanding = requests.find(r => r.status === 'sent' || r.status === 'viewed')

  if (toConfirm) {
    const confirm = async () => {
      setError(null)
      setPending(null)
      try {
        await act(toConfirm.id, 'confirm-stage')
        onConfirmed?.()
      } catch (err) {
        if (isPendingApproval(err)) setPending(err.message)
        else setError(err instanceof Error ? err.message : 'Could not confirm')
      }
    }
    return (
      <div className="mb-2 rounded border border-[#b9dfbb] border-l-2 border-l-success bg-white px-3 py-2.5 text-[12px]">
        <div className="font-semibold text-success-dark">✓ {signingDocumentLabel(toConfirm.documentType)} signed</div>
        <div className="mt-0.5 text-[#4a3820]">
          {toConfirm.signedName || toConfirm.signerName}
          {toConfirm.signerCapacity && toConfirm.signerCapacity !== 'owner' ? ` (${SIGNER_CAPACITY_LABELS[toConfirm.signerCapacity].toLowerCase()})` : ''}
          {' · '}{toConfirm.signedAt ? formatPerthDateTime(toConfirm.signedAt) : ''}
        </div>
        <div className="mt-1 text-[#7a6a50]">Check the signed copy, then confirm to move the job to Signed — Build Schedule.</div>
        {toConfirm.excessInvoice && (
          <div className={`mt-1 ${toConfirm.excessInvoice.paidDate ? 'text-success-dark' : 'text-[#7a6a50]'}`}>
            {excessInvoiceStatusLine(toConfirm.excessInvoice)}
          </div>
        )}
        {pending && <ApprovalNotice message={pending} style={{ marginTop: 4 }} />}
        {error && <div className="mt-1 text-red-700">{error}</div>}
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={documentUrl(toConfirm.id, 'signed')}
            target="_blank"
            rel="noopener"
            className="rounded border border-[#e0d8c8] bg-white px-2.5 py-1 font-medium text-body hover:bg-cream"
          >
            View signed PDF
          </a>
          <button
            onClick={confirm}
            disabled={busyId === toConfirm.id}
            className="rounded bg-ink px-2.5 py-1 font-semibold text-gold disabled:opacity-50"
          >
            {busyId === toConfirm.id ? 'Confirming…' : 'Confirm sign-off & move on'}
          </button>
        </div>
      </div>
    )
  }

  if (outstanding) {
    return (
      <div className="mb-2 rounded border border-[#e8dfc8] border-l-2 border-l-gold bg-white px-3 py-2 text-[11px] text-[#4a3820]">
        <span className="font-medium">{signingDocumentLabel(outstanding.documentType)}</span>
        {' '}— {outstanding.status === 'viewed' ? 'opened by' : 'sent to'} {outstanding.signerName}
        {outstanding.status === 'viewed' && outstanding.viewedAt ? ` (${formatPerthDateTime(outstanding.viewedAt)})` : ''}
      </div>
    )
  }

  return null
}

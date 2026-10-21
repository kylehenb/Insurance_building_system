'use client'

import { useEffect, useState } from 'react'
import { describeDevice, formatPerthDateTime } from '@/lib/signing/format'
import type { SigningEventSummary } from '@/lib/signing/types'
import { fetchAuditTrail } from './api'

const EVENT_LABELS: Record<string, string> = {
  created: 'Document generated',
  sent: 'Emailed to signer',
  resent: 'Emailed again with a new link',
  reminded: 'Reminder emailed',
  send_failed: 'Email failed to send',
  viewed: 'Opened by signer',
  document_opened: 'Full PDF opened by signer',
  signed: 'Signed',
  sign_failed: 'Signing attempt failed',
  signed_copy_sent: 'Signed copy emailed',
  revoked: 'Revoked',
  expired: 'Link expired',
  stage_confirmed: 'Sign-off confirmed by office',
  rate_limited: 'Blocked: too many attempts',
}

function detail(e: SigningEventSummary): string | null {
  const m = e.metadata
  switch (e.event) {
    case 'sent':
    case 'resent':
    case 'reminded':
      return m.to ? `To ${String(m.to)}` : null
    case 'signed':
      return [
        m.method === 'drawn' ? 'Drawn signature' : 'Typed signature',
        typeof m.signedSha256 === 'string' ? `SHA-256 ${m.signedSha256.slice(0, 16)}…` : null,
      ].filter(Boolean).join(' · ')
    case 'signed_copy_sent':
      return `Signer: ${m.toSigner ? 'sent' : 'not sent'} · Office: ${m.toOffice ? 'sent' : 'not sent'}`
    case 'revoked':
      return m.reason ? `Reason: ${String(m.reason)}` : null
    case 'send_failed':
    case 'sign_failed':
      return m.error ? String(m.error) : null
    case 'stage_confirmed':
      return m.stage ? `Job moved to ${String(m.stage).replace(/_/g, ' ')}` : null
    default:
      return null
  }
}

export function SigningAuditTrail({ requestId, refreshKey }: { requestId: string; refreshKey: string }) {
  const [events, setEvents] = useState<SigningEventSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAuditTrail(requestId)
      .then(data => { if (!cancelled) setEvents(data.events) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the audit trail') })
    return () => { cancelled = true }
  }, [requestId, refreshKey])

  if (error) return <p className="text-[12px] text-red-600">{error}</p>
  if (!events) return <p className="text-[12px] text-[#9e998f]">Loading audit trail…</p>
  if (events.length === 0) return <p className="text-[12px] text-[#9e998f]">No events yet.</p>

  return (
    <ol className="space-y-2 border-l-2 border-[#e8e4e0] pl-4">
      {events.map(e => (
        <li key={e.id} className="text-[12px]">
          <div className="font-medium text-[#1a1a1a]">{EVENT_LABELS[e.event] ?? e.event}</div>
          <div className="text-[#7a7268]">{formatPerthDateTime(e.createdAt)}</div>
          {detail(e) && <div className="text-[#5a5650]">{detail(e)}</div>}
          {(e.ip || e.userAgent) && (
            <div className="text-[#9e998f]">
              {[e.ip, e.userAgent ? describeDevice(e.userAgent) : null].filter(Boolean).join(' · ')}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

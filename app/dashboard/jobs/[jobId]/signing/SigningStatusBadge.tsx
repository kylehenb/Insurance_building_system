import type { SigningStatus } from '@/lib/signing/types'

const STYLES: Record<SigningStatus, { label: string; className: string }> = {
  draft:   { label: 'Draft — not sent', className: 'bg-surface text-[#7a7268] border-line' },
  sent:    { label: 'Sent',             className: 'bg-[#e8f0fb] text-[#1a4f8b] border-[#c5d8f2]' },
  viewed:  { label: 'Viewed',           className: 'bg-warning-bg text-warning-dark border-[#f5d9a8]' },
  signed:  { label: 'Signed',           className: 'bg-success-bg text-success-dark border-[#b9dfbb]' },
  expired: { label: 'Expired',          className: 'bg-surface text-[#7a7268] border-line' },
  revoked: { label: 'Revoked',          className: 'bg-danger-bg-2 text-danger-dark border-[#f3c5c0]' },
}

export function SigningStatusBadge({ status }: { status: SigningStatus }) {
  const s = STYLES[status] ?? STYLES.draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${s.className}`}>
      {s.label}
    </span>
  )
}

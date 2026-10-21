import type { SigningStatus } from '@/lib/signing/types'

const STYLES: Record<SigningStatus, { label: string; className: string }> = {
  draft:   { label: 'Draft — not sent', className: 'bg-[#f5f2ee] text-[#7a7268] border-[#e0dbd4]' },
  sent:    { label: 'Sent',             className: 'bg-[#e8f0fb] text-[#1a4f8b] border-[#c5d8f2]' },
  viewed:  { label: 'Viewed',           className: 'bg-[#fef3e2] text-[#92400e] border-[#f5d9a8]' },
  signed:  { label: 'Signed',           className: 'bg-[#e8f5e9] text-[#1b5e20] border-[#b9dfbb]' },
  expired: { label: 'Expired',          className: 'bg-[#f5f2ee] text-[#7a7268] border-[#e0dbd4]' },
  revoked: { label: 'Revoked',          className: 'bg-[#fdecea] text-[#991b1b] border-[#f3c5c0]' },
}

export function SigningStatusBadge({ status }: { status: SigningStatus }) {
  const s = STYLES[status] ?? STYLES.draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${s.className}`}>
      {s.label}
    </span>
  )
}

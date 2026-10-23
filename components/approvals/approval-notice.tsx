'use client'

// Shown where an action was saved for approval instead of being done
// (lib/approvals/client.ts). Neutral, not an error: nothing failed, it's
// waiting for an admin on the dashboard's "Waiting for approval" panel.

export function ApprovalNotice({ message, style }: { message: string; style?: React.CSSProperties }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start',
        background: '#fbf6ea', border: '0.5px solid #e2cf9f', borderRadius: 6,
        padding: '10px 12px', fontSize: 12, lineHeight: 1.5, color: '#6b5420',
        ...style,
      }}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1.2 }}>⏳</span>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Waiting for approval</div>
        <div>{message.replace(/^Sent for approval:\s*/, '')}</div>
      </div>
    </div>
  )
}

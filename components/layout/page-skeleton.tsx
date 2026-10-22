// Placeholder shown while a dashboard page loads (app/dashboard/**/loading.tsx).
// The sidebar stays in place; only the content area shows these blocks.

function Block({ width, height }: { width: number | string; height: number }) {
  return <div style={{ width, height, borderRadius: 6, background: 'var(--line-3)' }} />
}

export function PageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="animate-pulse motion-reduce:animate-none"
      style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Block width={220} height={22} />
        <Block width={140} height={12} />
      </div>
      <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Block width={90} height={12} />
            <Block width={`${40 + ((i * 17) % 35)}%`} height={12} />
            <div style={{ flex: 1 }} />
            <Block width={70} height={12} />
          </div>
        ))}
      </div>
    </div>
  )
}

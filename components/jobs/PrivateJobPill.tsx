// Small "Private" marker shown next to a job number anywhere jobs are
// searched or picked, so private (homeowner) jobs can be told apart from the
// insurance jobs that often share the same address.

interface PrivateJobPillProps {
  jobType?: string | null
  /** 'dark' for use on the sidebar's dark background. */
  tone?: 'light' | 'dark'
}

export function PrivateJobPill({ jobType, tone = 'light' }: PrivateJobPillProps) {
  if (jobType !== 'private') return null
  const colors =
    tone === 'dark'
      ? { background: '#22304d', color: '#a9c2f0', border: '1px solid #34497a' }
      : { background: '#eef4ff', color: '#3a5faa', border: '1px solid #c5d8f5' }
  return (
    <span
      style={{
        ...colors,
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.4,
        padding: '0 6px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        letterSpacing: 0.2,
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      Private
    </span>
  )
}

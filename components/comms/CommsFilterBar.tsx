'use client'

export type CommsFilters = {
  types: string[]
  contactTypes: string[]
  dateFrom: string
  dateTo: string
}

const ALL_TYPES = ['email', 'sms', 'note', 'system'] as const

interface CommsFilterBarProps {
  filters: CommsFilters
  contactTypeOptions: string[]
  onChange: (filters: CommsFilters) => void
}

function toggleItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
}

const pillStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 10,
  padding: '3px 10px',
  borderRadius: 20,
  border: `0.5px solid ${active ? '#1a1a1a' : '#e0dbd4'}`,
  background: active ? '#1a1a1a' : 'transparent',
  color: active ? '#c8b89a' : '#9a9088',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  transition: 'all 0.15s',
})

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#b0a898',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  flexShrink: 0,
}

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: '#e4dfd8',
  flexShrink: 0,
}

const dateInputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  border: '0.5px solid #e4dfd8',
  borderRadius: 5,
  background: '#fff',
  color: '#3a3530',
  fontFamily: 'DM Mono, monospace',
  outline: 'none',
}

export function CommsFilterBar({ filters, contactTypeOptions, onChange }: CommsFilterBarProps) {
  const hasActive =
    filters.types.length > 0 ||
    filters.contactTypes.length > 0 ||
    !!filters.dateFrom ||
    !!filters.dateTo

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '9px 16px',
        borderBottom: '0.5px solid #e4dfd8',
        background: '#fdfcfb',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Type filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={labelStyle}>Type</span>
        {ALL_TYPES.map(t => (
          <button
            key={t}
            onClick={() => onChange({ ...filters, types: toggleItem(filters.types, t) })}
            style={pillStyle(filters.types.includes(t))}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Contact type filters — only shown when options exist */}
      {contactTypeOptions.length > 0 && (
        <>
          <div style={dividerStyle} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={labelStyle}>Contact</span>
            {contactTypeOptions.map(ct => (
              <button
                key={ct}
                onClick={() => onChange({ ...filters, contactTypes: toggleItem(filters.contactTypes, ct) })}
                style={{
                  ...pillStyle(filters.contactTypes.includes(ct)),
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                {ct}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={dividerStyle} />

      {/* Date range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={labelStyle}>From</span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
          style={dateInputStyle}
        />
        <span style={labelStyle}>To</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => onChange({ ...filters, dateTo: e.target.value })}
          style={dateInputStyle}
        />
      </div>

      {/* Clear */}
      {hasActive && (
        <button
          onClick={() => onChange({ types: [], contactTypes: [], dateFrom: '', dateTo: '' })}
          style={{
            fontSize: 10,
            color: '#c8b89a',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            fontFamily: 'inherit',
            marginLeft: 'auto',
          }}
        >
          Clear
        </button>
      )}
    </div>
  )
}

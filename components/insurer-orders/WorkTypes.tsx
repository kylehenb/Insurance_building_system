'use client'

import React from 'react'
import { WORK_TYPES, WORK_TYPE_LABELS, isWorkType, sortWorkTypes } from '@/lib/insurer-orders/work-order-type'

// An insurer order's work types (one order can ask for several: "make safe
// and BAR"), as badges and as the checkboxes the office corrects them with —
// on the Insurer Orders page, the phone review and the job's Orders tab.

const BADGE_COLOURS: Record<string, { background: string; color: string }> = {
  make_safe: { background: 'var(--danger-bg-2)', color: 'var(--danger-strong)' },
  BAR: { background: 'var(--info-bg)', color: '#1a56db' },
  roof_report: { background: '#f0eef8', color: '#4a42a0' },
  leak_detection: { background: '#e6f2f8', color: '#1d5f80' },
  specialist: { background: '#eef6ea', color: '#3f6b2a' },
  quote_only: { background: '#fef3c7', color: 'var(--warning-dark)' },
}
const UNKNOWN = { background: '#f3f4f6', color: '#6b7280' }

export function WorkTypeBadges({ types, size = 11 }: { types: readonly string[]; size?: number }) {
  const sorted = sortWorkTypes(types)
  if (!sorted.length) return <span style={{ ...UNKNOWN, fontSize: size, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>No type</span>
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {sorted.map(t => (
        <span
          key={t}
          title={isWorkType(t) ? undefined : 'Not a work type the app knows — tick the right one'}
          style={{ ...(BADGE_COLOURS[t] ?? UNKNOWN), fontSize: size, fontWeight: 500, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}
        >
          {isWorkType(t) ? WORK_TYPE_LABELS[t] : `${t}?`}
        </span>
      ))}
    </span>
  )
}

/**
 * Tick every type the order asks for. Unknown wording from the parser is shown
 * so it can be unticked. onChange gets the new list in the app's order.
 */
export function WorkTypeCheckboxes({
  value, onChange, label = 'Work types', disabled = false, large = false,
}: {
  value: readonly string[]
  onChange: (types: string[]) => void
  label?: string
  disabled?: boolean
  large?: boolean
}) {
  const unknown = value.filter(t => !isWorkType(t))
  const options: { key: string; label: string }[] = [
    ...WORK_TYPES.map(t => ({ key: t as string, label: WORK_TYPE_LABELS[t] })),
    ...unknown.map(t => ({ key: t, label: `${t} (not recognised)` })),
  ]
  const toggle = (key: string) => {
    const next = value.includes(key) ? value.filter(t => t !== key) : [...value, key]
    onChange(sortWorkTypes(next))
  }
  return (
    <div>
      <div style={{ fontSize: large ? 12 : 9, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: large ? 8 : 6 }}>
        {options.map(o => {
          const on = value.includes(o.key)
          return (
            <label
              key={o.key}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: disabled ? 'default' : 'pointer',
                fontSize: large ? 15 : 12, padding: large ? '8px 12px' : '4px 8px', borderRadius: 6,
                border: `1px solid ${on ? 'var(--tan, #c8b89a)' : '#e4dfd8'}`,
                background: on ? 'var(--surface-2, #f7f3ee)' : 'transparent',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(o.key)} style={{ margin: 0 }} />
              {o.label}
            </label>
          )
        })}
      </div>
      {!value.length && (
        <div style={{ fontSize: large ? 13 : 11, color: 'var(--warning-dark, #92400e)', marginTop: 4 }}>
          Tick at least one before lodging.
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'

export type CommsFilters = {
  types: string[]
  contactTypes: string[]
  unread: boolean
  starred: boolean
  needsAction: boolean
}

export const DEFAULT_FILTERS: CommsFilters = {
  types: [],
  contactTypes: [],
  unread: false,
  starred: false,
  needsAction: false,
}

const TYPE_OPTIONS = ['Email', 'SMS', 'Phone', 'Note', 'Portal'] as const
const CONTACT_OPTIONS = ['Insured', 'Insurer', 'Trade'] as const

interface Props {
  filters: CommsFilters
  search: string
  activeCount: number
  onChange: (f: CommsFilters) => void
  onSearchChange: (s: string) => void
}

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
}

export function CommsFilterBar({ filters, search, activeCount, onChange, onSearchChange }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const totalActive =
    filters.types.length +
    filters.contactTypes.length +
    (filters.unread ? 1 : 0) +
    (filters.starred ? 1 : 0) +
    (filters.needsAction ? 1 : 0)

  function clearAll() {
    onChange(DEFAULT_FILTERS)
  }

  // Normalise display label → DB value (lowercase)
  function typeVal(label: string) { return label.toLowerCase() }
  function contactVal(label: string) { return label.toLowerCase() }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 16px',
        borderBottom: '0.5px solid #e6dfd0',
        background: '#fdfcfb',
        fontFamily: 'DM Sans, sans-serif',
        position: 'relative',
      }}
    >
      {/* Filters button + dropdown */}
      <div ref={panelRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 12px',
            background: '#fff',
            border: '1px solid #e6dfd0',
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            color: '#1b1712',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 11, color: '#8a8272' }}>▾</span>
          Filters
          <span
            style={{
              background: totalActive > 0 ? '#1c1815' : '#e6dfd0',
              color: totalActive > 0 ? '#efe9dd' : '#8a8272',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 10,
              minWidth: 18,
              textAlign: 'center',
            }}
          >
            {totalActive}
          </span>
        </button>

        {open && (
          <div
            style={{
              position: 'absolute',
              top: 36,
              left: 0,
              background: '#fff',
              border: '1px solid #e6dfd0',
              borderRadius: 10,
              boxShadow: '0 10px 28px rgba(0,0,0,.10)',
              width: 290,
              zIndex: 30,
              padding: 16,
            }}
          >
            {/* Type group */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#8a8272', fontWeight: 700, marginBottom: 8 }}>
                Type
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TYPE_OPTIONS.map(label => {
                  const val = typeVal(label)
                  const active = filters.types.includes(val)
                  return (
                    <button
                      key={val}
                      onClick={() => onChange({ ...filters, types: toggle(filters.types, val) })}
                      style={{
                        padding: '5px 11px',
                        border: `1px solid ${active ? '#1c1815' : '#e6dfd0'}`,
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: active ? '#1c1815' : '#fff',
                        color: active ? '#efe9dd' : '#1b1712',
                        fontFamily: 'inherit',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Contact group */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#8a8272', fontWeight: 700, marginBottom: 8 }}>
                Contact
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CONTACT_OPTIONS.map(label => {
                  const val = contactVal(label)
                  const active = filters.contactTypes.includes(val)
                  return (
                    <button
                      key={val}
                      onClick={() => onChange({ ...filters, contactTypes: toggle(filters.contactTypes, val) })}
                      style={{
                        padding: '5px 11px',
                        border: `1px solid ${active ? '#1c1815' : '#e6dfd0'}`,
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: active ? '#1c1815' : '#fff',
                        color: active ? '#efe9dd' : '#1b1712',
                        fontFamily: 'inherit',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Status group */}
            <div>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#8a8272', fontWeight: 700, marginBottom: 8 }}>
                Status
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {([
                  { key: 'unread' as const, label: '● Unread', activeColor: '#4a6fd4' },
                  { key: 'starred' as const, label: '★ Starred', activeColor: '#c9973a' },
                  { key: 'needsAction' as const, label: '⚑ Needs action', activeColor: '#c05a4a' },
                ] as const).map(({ key, label, activeColor }) => {
                  const active = filters[key]
                  return (
                    <button
                      key={key}
                      onClick={() => onChange({ ...filters, [key]: !active })}
                      style={{
                        padding: '5px 11px',
                        border: `1px solid ${active ? activeColor : '#e6dfd0'}`,
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: active ? activeColor : '#fff',
                        color: active ? '#fff' : '#1b1712',
                        fontFamily: 'inherit',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid #e6dfd0',
              }}
            >
              <button
                onClick={clearAll}
                style={{
                  fontSize: 12,
                  color: '#8a8272',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                Clear all
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: '#4a6fd4',
                  border: 'none',
                  padding: '5px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ flex: 1 }} />
      <input
        type="text"
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        placeholder="Search…"
        style={{
          border: '1px solid #e6dfd0',
          borderRadius: 8,
          padding: '7px 11px',
          fontSize: 12.5,
          fontFamily: 'DM Sans, sans-serif',
          width: 180,
          outline: 'none',
          color: '#1b1712',
          background: '#fff',
        }}
      />

      {/* Clear search shortcut */}
      {search && (
        <button
          onClick={() => onSearchChange('')}
          style={{
            fontSize: 11,
            color: '#b7b0a0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            fontFamily: 'inherit',
            marginLeft: -6,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

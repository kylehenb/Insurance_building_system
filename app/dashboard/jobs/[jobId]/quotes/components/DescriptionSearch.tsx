'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../hooks/useScopeLibrary'

interface DescriptionSearchProps {
  value: string
  onChange: (value: string) => void
  onSelect: (item: LibraryItem) => void
  onBlur?: () => void
  search: (q: string) => LibraryItem[]
  disabled?: boolean
}

export function DescriptionSearch({
  value,
  onChange,
  onSelect,
  onBlur,
  search,
  disabled,
}: DescriptionSearchProps) {
  const [results, setResults] = useState<LibraryItem[]>([])
  const [open, setOpen] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [matchedLibraryId, setMatchedLibraryId] = useState<string | null>(null)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value
      onChange(v)
      // Clear matched state on manual edit
      setMatchedLibraryId(null)

      if (v.length >= 2) {
        const r = search(v)
        setResults(r)
        setOpen(true)
        setNoMatch(r.length === 0)
      } else {
        setResults([])
        setOpen(false)
        setNoMatch(false)
      }
      setActiveIdx(-1)
    },
    [onChange, search]
  )

  const handleSelect = useCallback(
    (item: LibraryItem) => {
      onSelect(item)
      setMatchedLibraryId(item.id)
      setOpen(false)
      setResults([])
      setNoMatch(false)
      setActiveIdx(-1)
    },
    [onSelect]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault()
        handleSelect(results[activeIdx])
      } else if (e.key === 'Escape') {
        setOpen(false)
        setActiveIdx(-1)
      }
    },
    [open, results, activeIdx, handleSelect]
  )

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      // Delay to allow mousedown on dropdown items to fire first
      setTimeout(() => {
        if (!containerRef.current?.contains(document.activeElement)) {
          setOpen(false)
          setActiveIdx(-1)
          onBlur?.()
        }
      }, 160)
    },
    [onBlur]
  )

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setActiveIdx(-1)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Auto-resize textarea
  const rows = Math.max(2, Math.ceil((value?.length ?? 0) / 52))

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <textarea
        ref={textareaRef}
        value={value ?? ''}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        rows={rows}
        style={{
          width: '100%',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 12,
          color: '#3a3530',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: 0,
          lineHeight: 1.5,
          cursor: disabled ? 'default' : 'text',
        }}
        placeholder="Description…"
      />

      {/* No-match hint shown inline below textarea */}
      {open && noMatch && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: '#9e998f',
            fontStyle: 'italic',
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          No match — custom text will save.
        </div>
      )}

      {open && results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: -10,
            right: -10,
            background: '#ffffff',
            border: '1px solid #e0dbd4',
            borderRadius: 6,
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            zIndex: 100,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {results.map((item, idx) => (
            <button
              key={item.id}
              onMouseDown={e => {
                e.preventDefault()
                handleSelect(item)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: idx === activeIdx ? '#f5f2ee' : 'transparent',
                border: 'none',
                borderBottom: idx < results.length - 1 ? '1px solid #f5f2ee' : 'none',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: '#3a3530',
                  fontFamily: 'DM Sans, sans-serif',
                  lineHeight: 1.4,
                }}
              >
                {item.item_description}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                {item.trade && (
                  <span style={{ fontSize: 11, color: '#9e998f' }}>{item.trade}</span>
                )}
                {item.insurer_specific && (
                  <span style={{ fontSize: 11, color: '#c8b89a' }}>· {item.insurer_specific}</span>
                )}
                {item.labour_per_unit != null && (
                  <span style={{ fontSize: 11, color: '#9e998f', fontFamily: 'DM Mono, monospace' }}>
                    L: {item.labour_per_unit}
                  </span>
                )}
                {item.materials_per_unit != null && (
                  <span style={{ fontSize: 11, color: '#9e998f', fontFamily: 'DM Mono, monospace' }}>
                    M: {item.materials_per_unit}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

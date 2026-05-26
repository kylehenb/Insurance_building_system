'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ScopeSearchResult } from '../hooks/useScopeLibrary'

interface DescriptionSearchProps {
  value: string
  onChange: (value: string) => void
  onSelect: (item: ScopeSearchResult) => void
  onBlur?: () => void
  onNavigateNext?: () => void
  search: (q: string) => ScopeSearchResult[]
  disabled?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

function fmtRate(rate: number | null): string | null {
  if (rate == null) return null
  return `$${Math.round(rate).toLocaleString('en-AU')}`
}

export function DescriptionSearch({
  value,
  onChange,
  onSelect,
  onBlur,
  onNavigateNext,
  search,
  disabled,
  inputRef,
}: DescriptionSearchProps) {
  const [local, setLocal] = useState(value ?? '')
  const [results, setResults] = useState<ScopeSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = inputRef ?? internalRef
  const isFocusedRef = useRef(false)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value
      setLocal(v)

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
    [search]
  )

  const handleSelect = useCallback(
    (item: ScopeSearchResult) => {
      setLocal(item.item_description ?? '')
      setOpen(false)
      setResults([])
      setNoMatch(false)
      setActiveIdx(-1)
      onSelect(item)
    },
    [onSelect]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (open) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIdx(i => Math.min(i + 1, results.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIdx(i => Math.max(i - 1, 0))
          return
        }
        if (e.key === 'Enter' && activeIdx >= 0) {
          e.preventDefault()
          handleSelect(results[activeIdx])
          return
        }
        if (e.key === 'Escape') {
          setOpen(false)
          setActiveIdx(-1)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        setOpen(false)
        onNavigateNext?.()
      }
    },
    [open, results, activeIdx, handleSelect, onNavigateNext]
  )

  const handleBlur = useCallback(
    (_e: React.FocusEvent<HTMLTextAreaElement>) => {
      isFocusedRef.current = false
      setTimeout(() => {
        if (!containerRef.current?.contains(document.activeElement)) {
          setOpen(false)
          setActiveIdx(-1)
          onChange(local)
          onBlur?.()
        }
      }, 160)
    },
    [local, onChange, onBlur]
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

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocal(value ?? '')
    }
  }, [value])

  const rows = Math.max(2, Math.ceil((value?.length ?? 0) / 52))

  const libraryResults = results.filter(r => r.result_type === 'library')
  const referenceResults = results.filter(r => r.result_type === 'reference')

  // Flat index → result mapping for keyboard navigation
  const flatResults = results

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <textarea
        ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
        value={local}
        onChange={handleChange}
        onFocus={() => { isFocusedRef.current = true }}
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
          {/* Library results */}
          {libraryResults.map(item => {
            const idx = flatResults.indexOf(item)
            return (
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
                  borderBottom: '1px solid #f5f2ee',
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
                  {item.rate_labour != null && (
                    <span style={{ fontSize: 11, color: '#9e998f', fontFamily: 'DM Mono, monospace' }}>
                      L: {item.rate_labour}
                    </span>
                  )}
                  {item.rate_materials != null && (
                    <span style={{ fontSize: 11, color: '#9e998f', fontFamily: 'DM Mono, monospace' }}>
                      M: {item.rate_materials}
                    </span>
                  )}
                </div>
              </button>
            )
          })}

          {/* Reference results section */}
          {referenceResults.length > 0 && (
            <>
              {libraryResults.length > 0 && (
                <div style={{ height: 1, background: '#e0dbd4', margin: '0' }} />
              )}
              <div
                style={{
                  padding: '4px 12px 2px',
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#b45309',
                  fontFamily: 'DM Sans, sans-serif',
                  background: '#fef9ec',
                }}
              >
                Prior quotes
              </div>
              {referenceResults.map(item => {
                const idx = flatResults.indexOf(item)
                const metaParts = [
                  item.quote_ref,
                  fmtRate(item.rate_total),
                  item.reference_date,
                ].filter(Boolean)
                return (
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
                      background: idx === activeIdx ? '#fef3c7' : '#fef9ec',
                      border: 'none',
                      borderBottom: '1px solid #fde68a',
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
                    <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 10,
                          background: '#fef9ec',
                          color: '#b45309',
                          border: '1px solid #f0d080',
                          fontFamily: 'DM Sans, sans-serif',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Prior quote
                      </span>
                      {metaParts.length > 0 && (
                        <span
                          style={{
                            fontSize: 11,
                            color: '#9e998f',
                            fontFamily: 'DM Mono, monospace',
                          }}
                        >
                          {metaParts.join(' · ')}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

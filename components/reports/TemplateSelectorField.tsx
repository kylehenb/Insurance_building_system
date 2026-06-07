'use client'

import Fuse from 'fuse.js'
import { useEffect, useRef, useState } from 'react'
import type { ReportTemplate } from '@/types/reports'

interface TemplateSelectorFieldProps {
  reportType: string
  value: string | null
  onChange: (templateName: string | null) => void
  onTemplateSaved?: (templateName: string) => void
}

interface FuseResult {
  item: ReportTemplate
  score?: number
}

export default function TemplateSelectorField({
  reportType,
  value,
  onChange,
  onTemplateSaved,
}: TemplateSelectorFieldProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [creating, setCreating] = useState(false)
  const fuseRef = useRef<Fuse<ReportTemplate> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const buildFuse = (data: ReportTemplate[]) => {
    fuseRef.current = new Fuse(data, {
      keys: ['name'],
      threshold: 0.35,
      includeScore: true,
      ignoreLocation: true,
    })
  }

  useEffect(() => {
    fetch(`/api/report-templates?report_type=${encodeURIComponent(reportType)}`)
      .then(r => r.json())
      .then((data: ReportTemplate[]) => {
        setTemplates(data)
        buildFuse(data)
      })
      .catch(() => {})
  }, [reportType])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const getFilteredResults = (): FuseResult[] => {
    if (!query.trim()) {
      return templates.slice(0, 8).map(item => ({ item }))
    }
    const results = fuseRef.current?.search(query, { limit: 10 }) ?? []
    return results
      .slice()
      .sort((a, b) => {
        const scoreDiff = (a.score ?? 0) - (b.score ?? 0)
        if (Math.abs(scoreDiff) > 0.05) return scoreDiff
        return (b.item.use_count ?? 0) - (a.item.use_count ?? 0)
      })
  }

  const filteredResults = getFilteredResults()
  const hasExactMatch = filteredResults.some(
    r => r.item.name.toLowerCase() === query.trim().toLowerCase()
  )
  const showCreateOption = query.trim().length > 0 && !hasExactMatch
  const selectedTemplate = value
    ? templates.find(t => t.name.toLowerCase() === value.toLowerCase()) ?? null
    : null

  const refetchTemplates = async () => {
    try {
      const res = await fetch(
        `/api/report-templates?report_type=${encodeURIComponent(reportType)}`
      )
      if (res.ok) {
        const data: ReportTemplate[] = await res.json()
        setTemplates(data)
        buildFuse(data)
      }
    } catch { /* silent */ }
  }

  const handleSelect = async (template: ReportTemplate) => {
    setOpen(false)
    setQuery('')
    onChange(template.name)
    void fetch(`/api/report-templates/${template.id}/increment`, { method: 'PATCH' })
      .then(() => refetchTemplates())
  }

  const handleCreate = async () => {
    const name = query.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/report-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, report_type: reportType }),
      })
      if (res.ok) {
        const created: ReportTemplate = await res.json()
        setTemplates(prev => {
          const updated = [created, ...prev.filter(t => t.id !== created.id)]
          buildFuse(updated)
          return updated
        })
        setOpen(false)
        setQuery('')
        onChange(created.name)
        onTemplateSaved?.(created.name)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleClear = () => {
    setQuery('')
    onChange(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', marginBottom: 10 }}>
      <label
        style={{
          display: 'block',
          fontFamily: 'var(--font-dm-mono, monospace)',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted, #8a8680)',
          marginBottom: 5,
        }}
      >
        Damage Scenario Template
      </label>

      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--beige, #f5f0e8)',
            border: '1px solid var(--border, #d4cec6)',
            borderRadius: 6,
            padding: '8px 10px',
          }}
        >
          <span
            style={{
              flex: 1,
              fontFamily: 'var(--font-dm-mono, monospace)',
              fontSize: 12,
              color: 'var(--black, #1a1a1a)',
            }}
          >
            {value}
          </span>
          {selectedTemplate && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--muted, #8a8680)',
                fontFamily: 'var(--font-dm-mono, monospace)',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedTemplate.use_count ?? 0} report
              {(selectedTemplate.use_count ?? 0) !== 1 ? 's' : ''}
            </span>
          )}
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted, #8a8680)',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 2px',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          className="fa-input"
          type="text"
          placeholder="Search or create damage scenario…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
      )}

      {open && !value && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 200,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            maxHeight: 260,
            overflowY: 'auto',
            boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
          }}
        >
          {filteredResults.map(({ item }) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={() => handleSelect(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #2a2a2a',
                cursor: 'pointer',
                color: '#f5f0e8',
                textAlign: 'left',
                fontFamily: 'var(--font-dm-mono, monospace)',
                fontSize: 12,
              }}
            >
              <span>{item.name}</span>
              <span style={{ fontSize: 10, color: '#6a6560', marginLeft: 8, whiteSpace: 'nowrap' }}>
                {item.use_count ?? 0} use{(item.use_count ?? 0) !== 1 ? 's' : ''}
              </span>
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              onMouseDown={handleCreate}
              disabled={creating}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '9px 12px',
                background: 'none',
                border: 'none',
                cursor: creating ? 'not-allowed' : 'pointer',
                color: '#c9a96e',
                textAlign: 'left',
                fontFamily: 'var(--font-dm-mono, monospace)',
                fontSize: 11,
                opacity: creating ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 13 }}>+</span>
              <span>
                {creating
                  ? 'Creating…'
                  : `Create "${query.trim()}" as new template`}
              </span>
            </button>
          )}

          {filteredResults.length === 0 && !showCreateOption && (
            <div
              style={{
                padding: '10px 12px',
                color: '#6a6560',
                fontFamily: 'var(--font-dm-mono, monospace)',
                fontSize: 11,
              }}
            >
              No templates yet — type to create one
            </div>
          )}
        </div>
      )}
    </div>
  )
}

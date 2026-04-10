'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'

export interface FieldConfig {
  name: string
  label: string
  type: 'text' | 'date' | 'select'
  options?: string[]
}

interface CreateModalProps {
  title: string
  fields: FieldConfig[]
  onSubmit: (data: Record<string, string>) => Promise<void>
  onClose: () => void
  isOpen: boolean
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 13,
  background: '#fff',
  border: '1px solid #e0dbd4',
  borderRadius: 6,
  padding: '8px 10px',
  width: '100%',
  outline: 'none',
  color: '#3a3530',
}

const focusRing = {
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = '#c8b89a'
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = '#e0dbd4'
  },
}

export function CreateModal({ title, fields, onSubmit, onClose, isOpen }: CreateModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.name, '']))
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  function setValue(name: string, value: string) {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await onSubmit(values)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(26,26,26,0.4)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl bg-white shadow-xl"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0dbd4]">
          <h2 className="text-[15px] font-semibold text-[#3a3530]">{title}</h2>
          <button
            onClick={onClose}
            className="text-[#9e998f] hover:text-[#3a3530] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {fields.map(field => (
            <div key={field.name}>
              <label
                htmlFor={field.name}
                className="block text-[11px] uppercase tracking-[0.07em] text-[#9e998f] mb-1.5"
              >
                {field.label}
              </label>

              {field.type === 'select' ? (
                <select
                  id={field.name}
                  value={values[field.name]}
                  onChange={e => setValue(field.name, e.target.value)}
                  style={inputStyle as React.CSSProperties}
                  {...focusRing}
                >
                  <option value="">Select…</option>
                  {field.options?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={field.name}
                  type={field.type}
                  value={values[field.name]}
                  onChange={e => setValue(field.name, e.target.value)}
                  style={inputStyle as React.CSSProperties}
                  {...focusRing}
                />
              )}
            </div>
          ))}

          {error && (
            <p className="text-[13px] text-red-600">{error}</p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-[13px] text-[#9e998f] hover:text-[#3a3530] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-lg text-[13px] font-medium text-white transition-colors"
              style={{ background: loading ? '#b0a898' : '#3a3530' }}
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

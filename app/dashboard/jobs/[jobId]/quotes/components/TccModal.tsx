'use client'

import React, { useState } from 'react'

interface Props {
  quoteId: string
  onClose: () => void
}

const CONTACT_METHODS = [
  'Phone call',
  'Text message',
  'Email',
  'In person',
  'Other',
]

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #e0dbd4',
  borderRadius: 6,
  background: '#f5f2ee',
  color: '#3a3530',
  fontFamily: 'DM Sans, sans-serif',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

function formatDateForDisplay(dateStr: string) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTimeForDisplay(timeStr: string) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${m} ${ampm}`
}

export function TccModal({ quoteId, onClose }: Props) {
  const today = new Date()
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const defaultTime = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`

  const [dateContacted, setDateContacted] = useState(defaultDate)
  const [timeContacted, setTimeContacted] = useState(defaultTime)
  const [completedBy, setCompletedBy] = useState('Kyle Bindon')
  const [contactMethod, setContactMethod] = useState('Phone call')

  function handleGenerate() {
    const params = new URLSearchParams({
      date: formatDateForDisplay(dateContacted),
      time: formatTimeForDisplay(timeContacted),
      completedBy,
      method: contactMethod,
    })
    window.open(`/print/quotes/${quoteId}/tcc?${params.toString()}`, '_blank')
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9500,
        background: 'rgba(0,0,0,0.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 10,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          width: 400,
          padding: '28px 28px 24px',
          fontFamily: 'DM Sans, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>
            Telephone Clearance Certificate
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e998f', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b6560' }}>
              Date Contacted
            </span>
            <input
              type="date"
              value={dateContacted}
              onChange={e => setDateContacted(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b6560' }}>
              Time Contacted
            </span>
            <input
              type="time"
              value={timeContacted}
              onChange={e => setTimeContacted(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b6560' }}>
              Completed By
            </span>
            <input
              type="text"
              value={completedBy}
              onChange={e => setCompletedBy(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b6560' }}>
              Contact Method
            </span>
            <select
              value={contactMethod}
              onChange={e => setContactMethod(e.target.value)}
              style={inputStyle}
            >
              {CONTACT_METHODS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 24, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid #e0dbd4',
              borderRadius: 6,
              background: '#f5f2ee',
              color: '#3a3530',
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              background: '#1a1a1a',
              color: '#ffffff',
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Generate Certificate
          </button>
        </div>
      </div>
    </div>
  )
}

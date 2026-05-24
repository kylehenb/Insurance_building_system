'use client'

import { useEffect, useState } from 'react'
import type { FieldCorrection } from '@/types/brain'

interface CorrectionPromptProps {
  correction: FieldCorrection | null
  onClear: () => void
}

export function CorrectionPrompt({ correction, onClear }: CorrectionPromptProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    if (!correction) setStatus('idle')
  }, [correction])

  if (!correction) return null

  async function handleSave() {
    if (!correction) return
    setStatus('saving')
    try {
      await fetch('/api/brain/corrections/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(correction),
      })
      setStatus('saved')
      setTimeout(() => onClear(), 2000)
    } catch {
      setStatus('idle')
    }
  }

  return (
    <div
      style={{
        borderLeft: '2px solid #f59e0b',
        background: '#fffbeb',
        padding: '6px 12px',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginTop: 4,
        borderRadius: '0 4px 4px 0',
      }}
    >
      {status === 'saved' ? (
        <span style={{ color: '#2a6b50', fontWeight: 500 }}>✓ Saved</span>
      ) : (
        <>
          <span style={{ color: '#92400e', flex: 1 }}>
            You changed a generated value — save as a correction?
          </span>
          <button
            onClick={handleSave}
            disabled={status === 'saving'}
            style={{
              background: 'none',
              border: 'none',
              color: '#b45309',
              cursor: status === 'saving' ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 600,
              padding: '2px 0',
              fontFamily: 'inherit',
              opacity: status === 'saving' ? 0.6 : 1,
            }}
          >
            {status === 'saving' ? 'Saving…' : 'Save correction'}
          </button>
          <span style={{ color: '#d1d5db' }}>·</span>
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 0',
              fontFamily: 'inherit',
            }}
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}

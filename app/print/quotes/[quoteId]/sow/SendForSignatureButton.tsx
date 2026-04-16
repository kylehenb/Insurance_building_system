'use client'

import { useState } from 'react'

export function SendForSignatureButton({
  quoteId,
  insuredEmail,
}: {
  quoteId: string
  insuredEmail: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const hasEmail = insuredEmail != null && insuredEmail !== ''

  const handleClick = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/docuseal/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId }),
      })
      if (res.ok) {
        setResult({ success: true, message: `Sent to ${insuredEmail}` })
      } else {
        const data = await res.json()
        setResult({
          success: false,
          message: data.error || 'Something went wrong. Please try again.',
        })
      }
    } catch {
      setResult({ success: false, message: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="print:hidden">
      <button
        onClick={handleClick}
        disabled={!hasEmail || loading}
        title={!hasEmail ? 'No email address on file for this job' : undefined}
        className="fixed top-4 right-36 z-50 bg-[#1a1a1a] text-[#f5f0e8] px-4 py-2 rounded-lg font-medium hover:bg-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Sending…' : 'Send for Signature'}
      </button>
      {result && (
        <div
          className="fixed top-14 right-36 z-50 text-xs font-medium"
          style={{ color: result.success ? '#16a34a' : '#dc2626' }}
        >
          {result.message}
        </div>
      )}
    </div>
  )
}

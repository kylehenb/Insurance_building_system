'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SigningRequestSummary } from '@/lib/signing/types'
import { fetchJobSigning, requestAction, type SendDialogDefaults } from './api'

// Signing requests for one job. Refreshes when the window regains focus and
// every 30 seconds while a request is out for signature, so "Viewed" and
// "Signed" show up without a reload.

const POLL_MS = 30_000

export function useJobSigning(jobId: string) {
  const [requests, setRequests] = useState<SigningRequestSummary[]>([])
  const [defaults, setDefaults] = useState<SendDialogDefaults | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const data = await fetchJobSigning(jobId)
      if (!mounted.current) return
      setRequests(data.requests)
      setDefaults(data.defaults)
      setError(null)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not load signing requests')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    mounted.current = true
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const hasOpen = requests.some(r => r.status === 'sent' || r.status === 'viewed')
  useEffect(() => {
    if (!hasOpen) return
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [hasOpen, load])

  const act = useCallback(async (id: string, action: Parameters<typeof requestAction>[1], body?: Record<string, unknown>) => {
    setBusyId(id)
    try {
      const result = await requestAction(id, action, body)
      await load()
      return result
    } finally {
      if (mounted.current) setBusyId(null)
    }
  }, [load])

  return { requests, defaults, loading, error, busyId, reload: load, act }
}

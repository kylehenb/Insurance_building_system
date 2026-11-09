'use client'

import { useEffect } from 'react'

// Tells IRC this job is open on someone's screen: once a minute while the tab
// is visible (and straight away when it comes back into view). Checking the
// job's action cards against what's changed waits until nobody has it open
// (lib/actions/recheck.ts), so a long session on a job is one check at the
// end, not one after every change. Renders nothing.

const EVERY_MS = 60_000

export function JobPresence({ jobId }: { jobId: string }) {
  useEffect(() => {
    let last = 0
    const ping = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < EVERY_MS / 2) return
      last = Date.now()
      fetch(`/api/jobs/${jobId}/presence`, { method: 'POST' }).catch(() => {})
    }
    ping()
    const timer = setInterval(ping, EVERY_MS)
    document.addEventListener('visibilitychange', ping)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', ping) }
  }, [jobId])
  return null
}

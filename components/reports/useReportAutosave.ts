'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const DEBOUNCE_MS = 1500

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: Date | null
}

interface UseReportAutosaveOptions {
  reportId: string
  tenantId: string
}

export function useReportAutosave({ reportId, tenantId }: UseReportAutosaveOptions) {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [saveState, setSaveState] = useState<SaveState>({
    status: 'idle',
    lastSavedAt: null,
  })

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingChangesRef = useRef<Record<string, unknown>>({})

  const save = useCallback(
    async (changes: Record<string, unknown>) => {
      setSaveState(s => ({ ...s, status: 'saving' }))

      try {
        const { error } = await supabase
          .from('reports')
          .update(changes)
          .eq('id', reportId)
          .eq('tenant_id', tenantId)

        if (error) {
          console.error('[ReportAutosave] Update failed - changes keys:', JSON.stringify(Object.keys(changes)))
          console.error('[ReportAutosave] Update error details:', JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint }))
          throw error
        }

        pendingChangesRef.current = {}
        setSaveState({ status: 'saved', lastSavedAt: new Date() })

        // Reset to idle after 2s
        setTimeout(() => setSaveState(s => ({ ...s, status: 'idle' })), 2000)
      } catch (err) {
        console.error('[ReportAutosave] Error:', err)
        setSaveState(s => ({ ...s, status: 'error' }))
      }
    },
    [reportId, tenantId, supabase]
  )

  const scheduleFieldSave = useCallback(
    (fieldName: string, value: unknown) => {
      // Accumulate changes
      pendingChangesRef.current = {
        ...pendingChangesRef.current,
        [fieldName]: value,
      }

      // Clear existing timer
      if (debounceRef.current) clearTimeout(debounceRef.current)

      // Set saving indicator immediately for feel
      setSaveState(s => ({ ...s, status: 'saving' }))

      // Debounce the actual save
      debounceRef.current = setTimeout(() => {
        if (Object.keys(pendingChangesRef.current).length > 0) {
          save({ ...pendingChangesRef.current })
        }
      }, DEBOUNCE_MS)
    },
    [save]
  )

  const flushSave = useCallback((): Promise<void> => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (Object.keys(pendingChangesRef.current).length > 0) {
      return save({ ...pendingChangesRef.current })
    }
    return Promise.resolve()
  }, [save])

  return { scheduleFieldSave, flushSave, saveState }
}

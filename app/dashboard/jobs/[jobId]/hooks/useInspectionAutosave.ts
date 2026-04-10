'use client'

import { useCallback, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const DEBOUNCE_MS = 1500

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: Date | null
}

interface UseInspectionAutosaveOptions {
  inspectionId: string
  tenantId: string
}

export function useInspectionAutosave({ inspectionId, tenantId }: UseInspectionAutosaveOptions) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

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
          .from('inspections')
          .update(changes)
          .eq('id', inspectionId)
          .eq('tenant_id', tenantId)

        if (error) throw error

        pendingChangesRef.current = {}
        setSaveState({ status: 'saved', lastSavedAt: new Date() })

        setTimeout(() => setSaveState(s => ({ ...s, status: 'idle' })), 2000)
      } catch (err) {
        console.error('[InspectionAutosave] Error:', err)
        setSaveState(s => ({ ...s, status: 'error' }))
      }
    },
    [inspectionId, tenantId, supabase]
  )

  const scheduleFieldSave = useCallback(
    (fieldName: string, value: unknown) => {
      pendingChangesRef.current = { ...pendingChangesRef.current, [fieldName]: value }

      if (debounceRef.current) clearTimeout(debounceRef.current)

      setSaveState(s => ({ ...s, status: 'saving' }))

      debounceRef.current = setTimeout(() => {
        if (Object.keys(pendingChangesRef.current).length > 0) {
          save({ ...pendingChangesRef.current })
        }
      }, DEBOUNCE_MS)
    },
    [save]
  )

  const flushSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (Object.keys(pendingChangesRef.current).length > 0) {
      save({ ...pendingChangesRef.current })
    }
  }, [save])

  return { scheduleFieldSave, flushSave, saveState }
}

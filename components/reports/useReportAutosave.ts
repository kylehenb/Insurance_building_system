'use client'

import { useCallback, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const DEBOUNCE_MS = 1500

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: Date | null
}

interface UseReportAutosaveOptions {
  reportId: string
  tenantId: string
  userId: string
  currentSnapshot: Record<string, unknown>
  onVersionCreated?: () => void
}

export function useReportAutosave({
  reportId,
  tenantId,
  userId,
  currentSnapshot,
  onVersionCreated,
}: UseReportAutosaveOptions) {
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
  const previousSnapshotRef = useRef<Record<string, unknown>>(currentSnapshot)

  const save = useCallback(
    async (changes: Record<string, unknown>) => {
      setSaveState(s => ({ ...s, status: 'saving' }))

      try {
        // 1. Patch the reports row
        const { error: updateError } = await supabase
          .from('reports')
          .update(changes)
          .eq('id', reportId)
          .eq('tenant_id', tenantId)

        if (updateError) throw updateError

        // 2. Determine changed fields for version snapshot
        const changedFields = Object.keys(changes).filter(
          key =>
            JSON.stringify(changes[key]) !==
            JSON.stringify(previousSnapshotRef.current[key])
        )

        // 3. Get next version number
        const { data: versionData } = await supabase
          .from('report_versions')
          .select('version_number')
          .eq('report_id', reportId)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextVersion = (versionData?.version_number ?? 0) + 1

        // 4. Write version snapshot
        const fullSnapshot = { ...previousSnapshotRef.current, ...changes }
        await supabase.from('report_versions').insert({
          tenant_id: tenantId,
          report_id: reportId,
          version_number: nextVersion,
          snapshot: fullSnapshot,
          changed_fields: changedFields,
          changed_by: userId,
        })

        // 5. Update local ref
        previousSnapshotRef.current = fullSnapshot
        pendingChangesRef.current = {}

        setSaveState({ status: 'saved', lastSavedAt: new Date() })
        onVersionCreated?.()

        // Reset to idle after 2s
        setTimeout(() => setSaveState(s => ({ ...s, status: 'idle' })), 2000)
      } catch (err) {
        console.error('[ReportAutosave] Error:', err)
        setSaveState(s => ({ ...s, status: 'error' }))
      }
    },
    [reportId, tenantId, userId, supabase, onVersionCreated]
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

  const flushSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (Object.keys(pendingChangesRef.current).length > 0) {
      save({ ...pendingChangesRef.current })
    }
  }, [save])

  return { scheduleFieldSave, flushSave, saveState }
}

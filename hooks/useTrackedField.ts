'use client'

import { useState, useCallback, useRef } from 'react'
import type { FieldCorrection } from '@/types/brain'

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

interface UseTrackedFieldParams<T> {
  fieldName: string
  initialValue: T
  sourceType: 'playbook' | 'ai' | 'manual'
  playbookRunId?: string
  aiAuditId?: string
  onCorrectionDetected?: (correction: FieldCorrection<T>) => void
}

interface UseTrackedFieldReturn<T> {
  value: T
  setValue: (val: T) => void
  isDirty: boolean
  isSourced: boolean
  correction: FieldCorrection<T> | null
  clearCorrection: () => void
}

export function useTrackedField<T>({
  fieldName,
  initialValue,
  sourceType,
  playbookRunId,
  aiAuditId,
  onCorrectionDetected,
}: UseTrackedFieldParams<T>): UseTrackedFieldReturn<T> {
  const initialRef = useRef<T>(initialValue)
  const onCorrectionRef = useRef(onCorrectionDetected)
  const correctionShownRef = useRef(false)

  const [value, setValueState] = useState<T>(initialValue)
  const [isDirty, setIsDirty] = useState(false)
  const [correction, setCorrection] = useState<FieldCorrection<T> | null>(null)

  onCorrectionRef.current = onCorrectionDetected

  const isSourced = sourceType === 'playbook' || sourceType === 'ai'

  const setValue = useCallback(
    (val: T) => {
      setValueState(val)
      const sourced = sourceType === 'playbook' || sourceType === 'ai'
      const dirty = !deepEqual(val, initialRef.current)
      setIsDirty(dirty)

      if (dirty && sourced && !correctionShownRef.current) {
        correctionShownRef.current = true
        const c: FieldCorrection<T> = {
          fieldName,
          before: initialRef.current,
          after: val,
          sourceType: sourceType as 'playbook' | 'ai',
          ...(playbookRunId ? { playbookRunId } : {}),
          ...(aiAuditId ? { aiAuditId } : {}),
          detectedAt: new Date().toISOString(),
        }
        setCorrection(c)
        onCorrectionRef.current?.(c)
      } else if (!dirty) {
        correctionShownRef.current = false
        setCorrection(null)
      }
    },
    [fieldName, sourceType, playbookRunId, aiAuditId],
  )

  const clearCorrection = useCallback(() => {
    setCorrection(null)
  }, [])

  return { value, setValue, isDirty, isSourced, correction, clearCorrection }
}

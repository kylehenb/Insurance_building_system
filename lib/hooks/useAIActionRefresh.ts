import { useEffect } from 'react'

/**
 * Hook to automatically refresh data when AI actions complete.
 * Use this in any page that fetches data and needs to update when the AI widget performs actions.
 * 
 * @param refreshFn - Function to call when AI action completes (e.g., data fetch function)
 * @param dependencies - Dependencies array (like useEffect) - when these change, the listener is re-attached
 * 
 * @example
 * ```tsx
 * const refreshData = async () => {
 *   const { data } = await supabase.from('jobs').select('*')
 *   setJobs(data)
 * }
 * useAIActionRefresh(refreshData, [tenantId])
 * ```
 */
export function useAIActionRefresh(
  refreshFn: () => void | Promise<void>,
  dependencies: unknown[] = []
) {
  useEffect(() => {
    const handleAIActionComplete = () => {
      refreshFn()
    }

    window.addEventListener('ai-action-complete', handleAIActionComplete)

    return () => {
      window.removeEventListener('ai-action-complete', handleAIActionComplete)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
}

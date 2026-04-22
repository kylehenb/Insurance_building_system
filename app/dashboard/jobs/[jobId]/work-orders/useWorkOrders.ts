'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import {
  type WorkOrderWithDetails,
  type WorkOrderRow,
  type QuoteRow,
  type InvoiceRow,
  type TradeRow,
  type WorkOrderVisitRow,
  type ScopeItemRow,
  getPlacementState,
  getCushionDays,
  mergeCushionDays,
  woIsSent,
} from './types'

export interface WorkOrderMutations {
  placeWorkOrder:    (id: string, seqOrder: number) => Promise<void>
  unplaceWorkOrder:  (id: string) => Promise<void>
  reorderWorkOrders: (orderedIds: string[]) => Promise<void>
  sendWorkOrder:     (id: string) => Promise<void>
  sendAllUnsent:     () => Promise<void>
  cancelWorkOrder:   (id: string) => Promise<void>
  updateWorkOrder:   (id: string, updates: Partial<WorkOrderRow> & { cushionDays?: number; lagDays?: number; lagDescription?: string; visits?: Array<{ visit_number: number; scheduled_date?: string; estimated_hours?: number; status?: string }> }) => Promise<void>
  setPredecessor:    (id: string, predecessorId: string | null) => Promise<void>
  setParentWorkOrder: (id: string, parentId: string | null, offsetDays: number) => Promise<void>
  addVisit:          (workOrderId: string) => Promise<void>
  addWorkOrder:      (quoteId: string | null, workType: string) => Promise<void>
}

export interface WorkOrdersData {
  workOrders: WorkOrderWithDetails[]
  quotes:     QuoteRow[]
  trades:     TradeRow[]
  invoices:   InvoiceRow[]
  isLoading:  boolean
  error:      string | null
  refetch:    () => void
  mutations:  WorkOrderMutations
}

function makeSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export function useWorkOrders(jobId: string, tenantId: string): WorkOrdersData {
  const supabase   = useRef(makeSupabase()).current
  const fetchCount = useRef(0)

  const [workOrders, setWorkOrders] = useState<WorkOrderWithDetails[]>([])
  const [quotes,     setQuotes]     = useState<QuoteRow[]>([])
  const [trades,     setTrades]     = useState<TradeRow[]>([])
  const [invoices,   setInvoices]   = useState<InvoiceRow[]>([])
  const [isLoading,  setIsLoading]  = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const fetchId = ++fetchCount.current
    setIsLoading(true)
    setError(null)

    try {
      const [
        { data: woData,       error: woErr },
        { data: visitsData },
        { data: quotesData },
        { data: invoicesData },
        { data: tradesData },
      ] = await Promise.all([
        supabase
          .from('work_orders')
          .select('*')
          .eq('job_id', jobId)
          .eq('tenant_id', tenantId)
          .order('sequence_order', { ascending: true, nullsFirst: false }),
        supabase
          .from('work_order_visits')
          .select('*')
          .eq('job_id', jobId)
          .eq('tenant_id', tenantId)
          .order('visit_number', { ascending: true }),
        supabase
          .from('quotes')
          .select('*')
          .eq('job_id', jobId)
          .eq('tenant_id', tenantId)
          .eq('is_active_version', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('invoices')
          .select('*')
          .eq('job_id', jobId)
          .eq('tenant_id', tenantId)
          .eq('direction', 'inbound'),
        supabase
          .from('trades')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .order('makesafe_priority', { ascending: true, nullsFirst: false }),
      ])

      if (fetchId !== fetchCount.current) return
      if (woErr) { setError(woErr.message); return }

      // Scope items – only fetch if quotes exist
      const quoteIds = (quotesData ?? []).map(q => q.id)
      let scopeItems: ScopeItemRow[] = []
      if (quoteIds.length > 0) {
        const { data } = await supabase
          .from('scope_items')
          .select('*')
          .in('quote_id', quoteIds)
          .eq('tenant_id', tenantId)
        scopeItems = data ?? []
      }

      if (fetchId !== fetchCount.current) return

      // Build lookup maps
      const visitsMap = new Map<string, WorkOrderVisitRow[]>()
      for (const v of visitsData ?? []) {
        const arr = visitsMap.get(v.work_order_id) ?? []
        arr.push(v)
        visitsMap.set(v.work_order_id, arr)
      }

      const tradesMap = new Map<string, TradeRow>()
      for (const t of tradesData ?? []) tradesMap.set(t.id, t)

      const invoicesArr = invoicesData ?? []
      const woInvoiceMap = new Map<string, InvoiceRow>()
      for (const inv of invoicesArr) {
        if (inv.work_order_id) woInvoiceMap.set(inv.work_order_id, inv)
      }

      const scopeByQuote = new Map<string, ScopeItemRow[]>()
      for (const si of scopeItems) {
        const arr = scopeByQuote.get(si.quote_id) ?? []
        arr.push(si)
        scopeByQuote.set(si.quote_id, arr)
      }

      // Compose WorkOrderWithDetails
      const composed: WorkOrderWithDetails[] = (woData ?? []).map(wo => {
        const trade   = wo.trade_id ? (tradesMap.get(wo.trade_id) ?? null) : null
        const invoice = woInvoiceMap.get(wo.id) ?? null
        const visits  = visitsMap.get(wo.id) ?? []

        // Trade type label: use assigned trade's primary_trade, else work_type display
        let tradeTypeLabel = trade?.primary_trade ?? ''
        if (!tradeTypeLabel) {
          if (wo.work_type === 'make_safe') tradeTypeLabel = 'Make Safe'
          else if (wo.quote_id) {
            const items = scopeByQuote.get(wo.quote_id) ?? []
            tradeTypeLabel = items[0]?.trade ?? ''
          }
        }

        // Scope items for this work order: same quote + same trade label
        let woScopeItems: ScopeItemRow[] = []
        if (wo.quote_id) {
          const allForQuote = scopeByQuote.get(wo.quote_id) ?? []
          woScopeItems = tradeTypeLabel
            ? allForQuote.filter(si => si.trade === tradeTypeLabel)
            : allForQuote
        }

        const quotedAllowance = woScopeItems.reduce((s, si) => s + (si.line_total ?? 0), 0)

        const firstVisit = visits[0]
        const lagDays        = firstVisit?.lag_days_after   ?? 0
        const lagDescription = firstVisit?.lag_description  ?? ''

        return {
          ...wo,
          visits,
          scopeItems:      woScopeItems,
          trade,
          invoice,
          placementState:  getPlacementState(wo, invoicesArr),
          cushionDays:     getCushionDays(wo.notes),
          tradeTypeLabel,
          quotedAllowance,
          lagDays,
          lagDescription,
          parentWorkOrder: null,
          children: [],
        }
      })

      // Populate parent/child relationships
      const woMap = new Map<string, WorkOrderWithDetails>()
      composed.forEach(wo => woMap.set(wo.id, wo))

      composed.forEach(wo => {
        if (wo.parent_work_order_id) {
          const parent = woMap.get(wo.parent_work_order_id)
          if (parent) {
            wo.parentWorkOrder = parent
            parent.children.push(wo)
          }
        }
      })

      setWorkOrders(composed)
      setQuotes(quotesData ?? [])
      setTrades(tradesData ?? [])
      setInvoices(invoicesArr)
    } catch (e) {
      if (fetchId === fetchCount.current) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    } finally {
      if (fetchId === fetchCount.current) setIsLoading(false)
    }
  }, [jobId, tenantId, supabase])

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchData()

    const channel = supabase
      .channel(`work-orders-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_orders', filter: `job_id=eq.${jobId}` },
        () => fetchData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_order_visits', filter: `job_id=eq.${jobId}` },
        () => fetchData()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [jobId, fetchData, supabase])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const mutations: WorkOrderMutations = {
    placeWorkOrder: async (id, seqOrder) => {
      await supabase
        .from('work_orders')
        .update({ sequence_order: seqOrder })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      fetchData()
    },

    unplaceWorkOrder: async (id) => {
      await supabase
        .from('work_orders')
        .update({ sequence_order: null, predecessor_work_order_id: null })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      fetchData()
    },

    reorderWorkOrders: async (orderedIds) => {
      const updates = orderedIds.map((id, idx) =>
        supabase
          .from('work_orders')
          .update({ sequence_order: idx + 1 })
          .eq('id', id)
          .eq('tenant_id', tenantId)
      )
      await Promise.all(updates)
      fetchData()
    },

    sendWorkOrder: async (id) => {
      const wo = workOrders.find(w => w.id === id)
      if (!wo) return
      const newGaryState = wo.predecessor_work_order_id ? 'waiting_on_dependent' : 'waiting_reply'
      await supabase
        .from('work_orders')
        .update({ gary_state: newGaryState })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      await supabase.from('communications').insert({
        tenant_id:    tenantId,
        job_id:       jobId,
        work_order_id: id,
        type:         'portal',
        direction:    'outbound',
        contact_type: 'trade',
        content:      'Work order issued',
      })
      fetchData()
    },

    sendAllUnsent: async () => {
      const toSend = workOrders.filter(
        w => woIsPlaced(w) && !woIsSent(w) && w.placementState !== 'placed_complete'
      )
      await Promise.all(
        toSend.map(async wo => {
          const newGaryState = wo.predecessor_work_order_id ? 'waiting_on_dependent' : 'waiting_reply'
          await supabase
            .from('work_orders')
            .update({ gary_state: newGaryState })
            .eq('id', wo.id)
            .eq('tenant_id', tenantId)
          await supabase.from('communications').insert({
            tenant_id:    tenantId,
            job_id:       jobId,
            work_order_id: wo.id,
            type:         'portal',
            direction:    'outbound',
            contact_type: 'trade',
            content:      'Work order issued',
          })
        })
      )
      fetchData()
    },

    cancelWorkOrder: async (id) => {
      await supabase
        .from('work_orders')
        .update({ gary_state: 'not_started', sequence_order: null })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      fetchData()
    },

    updateWorkOrder: async (id, updates) => {
      const wo = workOrders.find(w => w.id === id)
      if (!wo) return

      const dbUpdates: Partial<WorkOrderRow> = { ...updates }
      delete (dbUpdates as Record<string, unknown>).cushionDays
      delete (dbUpdates as Record<string, unknown>).lagDays
      delete (dbUpdates as Record<string, unknown>).lagDescription
      delete (dbUpdates as Record<string, unknown>).visits

      // Handle cushionDays → notes JSON
      if (updates.cushionDays !== undefined) {
        dbUpdates.notes = mergeCushionDays(wo.notes, updates.cushionDays)
      }

      if (Object.keys(dbUpdates).length > 0) {
        await supabase
          .from('work_orders')
          .update(dbUpdates)
          .eq('id', id)
          .eq('tenant_id', tenantId)
      }

      // Handle visits array (for drag-and-drop placement)
      if (updates.visits && Array.isArray(updates.visits)) {
        for (const visitUpdate of updates.visits) {
          const existingVisit = wo.visits.find(v => v.visit_number === visitUpdate.visit_number)
          if (existingVisit) {
            // Update existing visit
            await supabase
              .from('work_order_visits')
              .update({
                scheduled_date: visitUpdate.scheduled_date ?? existingVisit.scheduled_date,
                estimated_hours: visitUpdate.estimated_hours ?? existingVisit.estimated_hours,
                status: visitUpdate.status ?? existingVisit.status,
              })
              .eq('id', existingVisit.id)
              .eq('tenant_id', tenantId)
          } else {
            // Create new visit
            await supabase.from('work_order_visits').insert({
              tenant_id: tenantId,
              job_id: jobId,
              work_order_id: id,
              visit_number: visitUpdate.visit_number,
              scheduled_date: visitUpdate.scheduled_date,
              estimated_hours: visitUpdate.estimated_hours,
              status: visitUpdate.status ?? 'unscheduled',
            })
          }
        }
      }

      // Handle lag → update/create first visit (legacy support)
      if (updates.lagDays !== undefined || updates.lagDescription !== undefined) {
        const firstVisit = wo.visits[0]
        if (firstVisit) {
          await supabase
            .from('work_order_visits')
            .update({
              lag_days_after:  updates.lagDays        ?? firstVisit.lag_days_after,
              lag_description: updates.lagDescription ?? firstVisit.lag_description,
            })
            .eq('id', firstVisit.id)
            .eq('tenant_id', tenantId)
        } else if (updates.lagDays !== undefined) {
          // Create first visit
          await supabase.from('work_order_visits').insert({
            tenant_id:      tenantId,
            job_id:         jobId,
            work_order_id:  id,
            visit_number:   1,
            lag_days_after: updates.lagDays,
            lag_description: updates.lagDescription ?? '',
            status:         'unscheduled',
          })
        }
      }

      fetchData()
    },

    setPredecessor: async (id: string, predecessorId: string | null) => {
      await supabase
        .from('work_orders')
        .update({ predecessor_work_order_id: predecessorId })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      fetchData()
    },

    setParentWorkOrder: async (id, parentId, offsetDays) => {
      await supabase
        .from('work_orders')
        .update({ parent_work_order_id: parentId, scheduling_offset_days: offsetDays })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      fetchData()
    },

    addVisit: async (workOrderId) => {
      const wo = workOrders.find(w => w.id === workOrderId)
      if (!wo) return
      const nextVisitNum = (wo.total_visits ?? 0) + 1
      await supabase.from('work_order_visits').insert({
        tenant_id:     tenantId,
        job_id:        jobId,
        work_order_id: workOrderId,
        visit_number:  nextVisitNum,
        status:        'unscheduled',
      })
      await supabase
        .from('work_orders')
        .update({ total_visits: nextVisitNum })
        .eq('id', workOrderId)
        .eq('tenant_id', tenantId)
      fetchData()
    },

    addWorkOrder: async (quoteId, workType) => {
      await supabase.from('work_orders').insert({
        tenant_id: tenantId,
        job_id:    jobId,
        quote_id:  quoteId,
        work_type: workType,
        status:    'pending',
        gary_state: 'not_started',
        total_visits: 1,
        current_visit: 1,
      })
      fetchData()
    },
  }

  return { workOrders, quotes, trades, invoices, isLoading, error, refetch: fetchData, mutations }
}

// ── Helpers used by mutations (exported for components that need them) ─────────
function woIsPlaced(wo: WorkOrderWithDetails): boolean {
  return wo.sequence_order !== null && wo.sequence_order !== undefined
}

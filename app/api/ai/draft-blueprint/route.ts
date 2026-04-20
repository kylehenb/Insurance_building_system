import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import type { BlueprintDraftData } from '@/lib/types/scheduling'

export const dynamic = 'force-dynamic'

interface ScopeItemWithLibrary {
  id: string
  quote_id: string
  trade: string | null
  keyword: string | null
  item_description: string | null
  unit: string | null
  qty: number | null
  rate_total: number | null
  line_total: number | null
  estimated_hours: number | null
}

interface TradeTypeSequenceRow {
  trade_type: string | null
  typical_sequence_order: number | null
  typical_visit_count: number | null
  typical_depends_on: string[] | null
  typical_comes_before: string[] | null
  typically_paired_with: string[] | null
  can_run_concurrent_with: string[] | null
  cant_run_concurrent_with: string[] | null
  typical_lag_days: number | null
  lag_description: string | null
  notes: string | null
}

interface TradeRow {
  id: string
  primary_trade: string | null
  business_name: string | null
  availability: string | null
  priority_rank: number | null
  address: string | null
  lat: number | null
  lng: number | null
  service_area: string[] | null
}

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  try {
    const body = await req.json()
    const { jobId, tenantId } = body

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Get the approved quote for this job
    const APPROVED_STATUSES = [
      'approved_contracts_pending',
      'approved_contracts_sent',
      'approved_contracts_signed',
      'pre_repair',
      'repairs_in_progress',
      'repairs_complete_to_invoice',
      'complete_and_invoiced',
      // legacy short-form values
      'approved',
      'partially_approved',
    ]

    const { data: quotes, error: quoteError } = await supabase
      .from('quotes')
      .select('*')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .in('status', APPROVED_STATUSES)
      .eq('is_active_version', true)
      .order('created_at', { ascending: false })
      .limit(1)

    const quote = quotes?.[0] ?? null

    if (quoteError || !quote) {
      console.error('Quote fetch error:', quoteError)
      return NextResponse.json({ error: 'No approved quote found for this job' }, { status: 404 })
    }

    console.log('Found quote:', quote.id, quote.quote_ref, quote.status)

    // Get scope items - try to include estimated_hours, fall back to join with scope_library
    let scopeItems: any[] = []
    let itemsError: any = null

    try {
      const result = await supabase
        .from('scope_items')
        .select('id, quote_id, trade, keyword, item_description, unit, qty, rate_total, line_total, estimated_hours, scope_library_id')
        .eq('quote_id', quote.id)
        .eq('tenant_id', tenantId)

      if (result.error) {
        // If column doesn't exist, try without estimated_hours
        const fallbackResult = await supabase
          .from('scope_items')
          .select('id, quote_id, trade, keyword, item_description, unit, qty, rate_total, line_total, scope_library_id')
          .eq('quote_id', quote.id)
          .eq('tenant_id', tenantId)

        if (fallbackResult.error) {
          itemsError = fallbackResult.error
        } else {
          scopeItems = fallbackResult.data || []
          // Fetch library items to get estimated_hours
          const libraryIds = scopeItems
            .filter((item: any) => item.scope_library_id)
            .map((item: any) => item.scope_library_id)

          if (libraryIds.length > 0) {
            const { data: libraryItems } = await supabase
              .from('scope_library')
              .select('id, estimated_hours')
              .in('id', libraryIds)

            const libraryMap = new Map(libraryItems?.map((li: any) => [li.id, li.estimated_hours]))
            scopeItems.forEach((item: any) => {
              if (item.scope_library_id) {
                item.estimated_hours = libraryMap.get(item.scope_library_id)
              }
            })
          }
        }
      } else {
        scopeItems = result.data || []
      }
    } catch (e) {
      itemsError = e
    }

    if (itemsError || !scopeItems || scopeItems.length === 0) {
      return NextResponse.json({
        error: 'No scope items found for this quote',
        details: `Quote ID: ${quote.id}, Quote Ref: ${quote.quote_ref}, Error: ${itemsError?.message || 'No items returned'}`
      }, { status: 404 })
    }

    const itemsWithLibrary: ScopeItemWithLibrary[] = scopeItems.map((item: any) => {
      // For custom items without estimated_hours, estimate from line_total/rate
      let estimatedHours = item.estimated_hours
      if (estimatedHours === null || estimatedHours === undefined) {
        if (item.rate_total && item.rate_total > 0 && item.qty && item.qty > 0) {
          // Rough estimate: (line_total / rate_total) * qty / 60 (assuming hourly rate)
          estimatedHours = (item.line_total || 0) / item.rate_total * item.qty / 60
        } else {
          // Fallback: 1 hour per $100 of line_total
          estimatedHours = (item.line_total || 0) / 100
        }
      }

      return {
        id: item.id,
        quote_id: item.quote_id,
        trade: item.trade,
        keyword: item.keyword,
        item_description: item.item_description,
        unit: item.unit,
        qty: item.qty,
        rate_total: item.rate_total,
        line_total: item.line_total,
        estimated_hours: estimatedHours ?? 0,
      }
    })

    // Get trade type sequence
    const { data: tradeSequence } = await supabase
      .from('trade_type_sequence')
      .select('*')
      .eq('tenant_id', tenantId)

    const sequenceMap = new Map<string, TradeTypeSequenceRow>()
    tradeSequence?.forEach((ts: any) => {
      if (ts.trade_type) {
        sequenceMap.set(ts.trade_type.toLowerCase(), ts as TradeTypeSequenceRow)
      }
    })

    // Get available trades
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    const tradesMap = new Map<string, TradeRow>()
    trades?.forEach((t: any) => {
      if (t.primary_trade) {
        tradesMap.set(t.primary_trade.toLowerCase(), t as TradeRow)
      }
    })

    // Group scope items by trade
    const itemsByTrade = new Map<string, ScopeItemWithLibrary[]>()
    itemsWithLibrary.forEach(item => {
      if (item.trade) {
        const tradeKey = item.trade.toLowerCase()
        if (!itemsByTrade.has(tradeKey)) {
          itemsByTrade.set(tradeKey, [])
        }
        itemsByTrade.get(tradeKey)!.push(item)
      }
    })

    // Build context for AI
    const tradesContext = Array.from(itemsByTrade.entries()).map(([tradeName, items]) => {
      const sequenceInfo = sequenceMap.get(tradeName)
      const totalHours = items.reduce((sum, item) => sum + (item.estimated_hours || 0), 0)
      const totalValue = items.reduce((sum, item) => sum + (item.line_total || 0), 0)

      console.log(`Trade: ${tradeName}, Items: ${items.length}, Total Hours: ${totalHours}, Total Value: ${totalValue}`)

      return {
        trade_type: tradeName,
        item_count: items.length,
        total_hours: totalHours,
        total_value: totalValue,
        typical_sequence_order: sequenceInfo?.typical_sequence_order,
        typical_visit_count: sequenceInfo?.typical_visit_count || 1,
        depends_on: sequenceInfo?.typical_depends_on || [],
        comes_before: sequenceInfo?.typical_comes_before || [],
        can_run_concurrent_with: sequenceInfo?.can_run_concurrent_with || [],
        cant_run_concurrent_with: sequenceInfo?.cant_run_concurrent_with || [],
        typical_lag_days: sequenceInfo?.typical_lag_days || 0,
        lag_description: sequenceInfo?.lag_description || null,
        available_trades: (trades || []).filter((t: any) =>
          t.primary_trade?.toLowerCase() === tradeName
        ).map((t: any) => ({
          id: t.id,
          business_name: t.business_name,
          availability: t.availability,
          priority_rank: t.priority_rank,
          service_area: t.service_area,
        })),
      }
    })

    // Get the schedule_blueprint_draft prompt
    const { data: promptData } = await supabase
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'schedule_blueprint_draft')
      .single()

    const systemPrompt = promptData?.system_prompt || 
      'Analyze the job scope and generate a draft schedule blueprint. Consider: trade dependencies, typical sequence, estimated durations, and any constraints. Propose a logical sequence with phases and timing. Flag any scheduling conflicts or risks.'

    // Call Claude to generate blueprint draft
    const userMessage = `Generate a draft schedule blueprint for this job.

Job ID: ${jobId}
Quote ID: ${quote.id}

Trade scope and scheduling context:
${JSON.stringify(tradesContext, null, 2)}

Return ONLY a JSON object with this structure:
{
  "trades": [
    {
      "trade_type": "string",
      "trade_id": "string (or null if no suitable trade found)",
      "trade_name": "string (business name, or null if no trade selected)",
      "proximity_range": "standard" | "extended",
      "availability": "more_capacity" | "maintain_capacity" | "reduce_capacity" | "on_pause",
      "sequence_order": number,
      "is_concurrent": boolean,
      "predecessor_index": number | null,
      "estimated_hours": number,
      "visits": [
        {
          "visit_number": number,
          "estimated_hours": number,
          "lag_days_after": number,
          "lag_description": "string | null"
        }
      ]
    }
  ]
}

Guidelines:
- sequence_order: Use the typical_sequence_order as a guide, but adjust based on dependencies
- is_concurrent: true if this trade can run concurrently with its predecessor based on can_run_concurrent_with
- predecessor_index: The array index (0-based) of the trade this depends on, or null if no dependency
- Select the best available trade for each trade_type based on availability and priority_rank
- If no suitable trade is available, set trade_id and trade_name to null
- Split estimated_hours across visits based on typical_visit_count
- Include lag_days_after and lag_description from the scope items when applicable
- proximity_range: "extended" if the best trade is outside standard service area, otherwise "standard"
`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format from Claude' }, { status: 500 })
    }

    // Parse the JSON response
    let draftData: BlueprintDraftData
    try {
      // Extract JSON from the response (Claude might wrap it in markdown)
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      draftData = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('Failed to parse Claude response:', content.text)
      return NextResponse.json({ 
        error: 'Failed to parse AI response',
        details: content.text 
      }, { status: 500 })
    }

    // Validate the structure
    if (!draftData.trades || !Array.isArray(draftData.trades)) {
      return NextResponse.json({ error: 'Invalid blueprint structure: missing trades array' }, { status: 500 })
    }

    // Create or update the blueprint
    const { data: existingBlueprint } = await supabase
      .from('job_schedule_blueprints')
      .select('*')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .single()

    let blueprintId: string

    if (existingBlueprint) {
      // Update existing draft
      const { data: updated, error: updateError } = await supabase
        .from('job_schedule_blueprints')
        .update({
          draft_data: draftData as any,
        })
        .eq('id', existingBlueprint.id)
        .select('id')
        .single()

      if (updateError || !updated) {
        return NextResponse.json({ error: 'Failed to update blueprint' }, { status: 500 })
      }
      blueprintId = updated.id
    } else {
      // Create new blueprint
      const { data: created, error: createError } = await supabase
        .from('job_schedule_blueprints')
        .insert({
          tenant_id: tenantId,
          job_id: jobId,
          status: 'draft',
          draft_data: draftData as any,
        })
        .select('id')
        .single()

      if (createError || !created) {
        return NextResponse.json({ error: 'Failed to create blueprint' }, { status: 500 })
      }
      blueprintId = created.id
    }

    return NextResponse.json({
      success: true,
      blueprintId,
      draftData,
      message: 'Blueprint draft generated successfully',
    })
  } catch (error) {
    console.error('Error generating blueprint draft:', error)
    return NextResponse.json({ 
      error: 'Failed to generate blueprint draft',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

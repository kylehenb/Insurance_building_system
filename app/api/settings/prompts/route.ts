import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

interface PromptRow {
  id: string
  tenant_id: string
  key: string
  name: string
  category: string
  report_type: string | null
  system_prompt: string
  previous_prompt: string | null
  notes: string | null
  updated_by: string | null
  updated_at: string
  created_at: string
}

export async function GET(req: NextRequest) {
  const userSession = await getUser()
  
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = userSession.tenant_id
  const supabase = createServiceClient()

  const { data: prompts, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ prompts: prompts ?? [] })
}

export async function PATCH(req: NextRequest) {
  const userSession = await getUser()
  
  if (!userSession || !userSession.tenant_id || !userSession.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = userSession.tenant_id
  const userId = userSession.user.id
  
  try {
    const body = await req.json()
    const { id, system_prompt, notes } = body

    if (!id || !system_prompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // First, fetch the current prompt to get the previous_prompt value
    const { data: currentPrompt, error: fetchError } = await supabase
      .from('prompts')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !currentPrompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    }

    // Update the prompt, copying current system_prompt to previous_prompt
    const { data: updatedPrompt, error: updateError } = await supabase
      .from('prompts')
      .update({
        system_prompt,
        previous_prompt: currentPrompt.system_prompt,
        notes: notes !== undefined ? notes : currentPrompt.notes,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single()

    if (updateError || !updatedPrompt) {
      return NextResponse.json({ error: updateError?.message || 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ prompt: updatedPrompt })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  
  if (!userSession || !userSession.tenant_id || !userSession.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = userSession.tenant_id
  const userId = userSession.user.id
  
  try {
    const body = await req.json()
    const { id, action } = body

    if (!id || action !== 'revert') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch the current prompt
    const { data: currentPrompt, error: fetchError } = await supabase
      .from('prompts')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !currentPrompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    }

    if (!currentPrompt.previous_prompt) {
      return NextResponse.json({ error: 'No previous prompt to revert to' }, { status: 400 })
    }

    // Swap system_prompt and previous_prompt
    const { data: updatedPrompt, error: updateError } = await supabase
      .from('prompts')
      .update({
        system_prompt: currentPrompt.previous_prompt,
        previous_prompt: currentPrompt.system_prompt,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single()

    if (updateError || !updatedPrompt) {
      return NextResponse.json({ error: updateError?.message || 'Revert failed' }, { status: 500 })
    }

    return NextResponse.json({ prompt: updatedPrompt })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

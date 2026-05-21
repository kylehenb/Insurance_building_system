import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  await params // consume

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { context, photoCount, jobContext } = await req.json()

  if (!context?.trim() || !photoCount) {
    return NextResponse.json({ ok: false, labels: [] })
  }

  const service = supabase
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const tenantId = userRow.tenant_id

  let systemInstruction = 'You are labelling roof inspection photos for a building insurance report. Generate specialized labels identifying roof section, covering material, pitch, flashing details, drainage elements, and any storm damage. Use roofing industry terminology.'
  try {
    const { data: promptData } = await service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'photo_label_roof')
      .single()
    if (promptData?.system_prompt) {
      systemInstruction = promptData.system_prompt
    }
  } catch (e) {
    console.error('Failed to fetch roof photo labelling prompt, using default:', e)
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', systemInstruction })

  const prompt = `Job context:
- Loss type: ${jobContext?.lossType || 'Unknown'}
- Insurer: ${jobContext?.insurer || 'Unknown'}
- Address: ${jobContext?.address || 'Unknown'}

The inspector described their roof photos as follows:
"${context}"

Generate exactly ${photoCount} photo label(s). Each label should follow the format "Roof section - damage description" (e.g. "Ridge capping - cracked pointing", "Valley - debris blockage", "Gutter - overflow at downpipe").

Rules:
- Labels should be professional and specific to roofing
- Match the number of photos (${photoCount})
- If context describes fewer locations than photos, distribute intelligently
- Keep each label under 80 characters
- Use roofing industry terminology (e.g., ridge, valley, flashing, penetration, soffit, fascia)

Return ONLY a JSON array of strings, one per photo, in order:
["label 1", "label 2", ...]`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return NextResponse.json({ ok: false, labels: [] })

    const labels = JSON.parse(match[0])
    return NextResponse.json({ ok: true, labels })
  } catch (e) {
    console.error('AI label error:', e)
    return NextResponse.json({ ok: false, labels: [] })
  }
}

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

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })

  const prompt = `You are labelling photos for a building insurance inspection report.

Job context:
- Loss type: ${jobContext?.lossType || 'Unknown'}
- Insurer: ${jobContext?.insurer || 'Unknown'}
- Address: ${jobContext?.address || 'Unknown'}

The inspector described their photos as follows:
"${context}"

Generate exactly ${photoCount} photo label(s). Each label should follow the format "Location - damage description" (e.g. "Living Room - water-damaged ceiling", "Kitchen - sagging plasterboard").

Rules:
- Labels should be professional and specific
- Match the number of photos (${photoCount})
- If context describes fewer locations than photos, distribute intelligently
- Keep each label under 80 characters

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

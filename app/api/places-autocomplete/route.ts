import { NextRequest, NextResponse } from 'next/server'

interface GooglePrediction {
  description: string
  place_id: string
  structured_formatting?: {
    main_text: string
    secondary_text: string
  }
}

interface GoogleAutocompleteResponse {
  status: string
  predictions: GooglePrediction[]
}

// GET /api/places-autocomplete?input=...
// Calls the Google Places Autocomplete API server-side (hides API key).
// Returns: { suggestions: Array<{ description, place_id, main_text, secondary_text }> }
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get('input')

  if (!input || input.trim().length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Geocoding service not configured' }, { status: 503 })
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
    url.searchParams.set('input', input)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('components', 'country:au')
    url.searchParams.set('language', 'en')

    const res = await fetch(url.toString())
    if (!res.ok) {
      return NextResponse.json({ error: 'Places service unavailable' }, { status: 502 })
    }

    const data = (await res.json()) as GoogleAutocompleteResponse

    if (data.status === 'ZERO_RESULTS') {
      return NextResponse.json({ suggestions: [] })
    }

    if (data.status !== 'OK') {
      return NextResponse.json(
        { error: `Places API error: ${data.status}` },
        { status: 502 }
      )
    }

    return NextResponse.json({
      suggestions: data.predictions.map((p) => ({
        description: p.description,
        place_id: p.place_id,
        main_text: p.structured_formatting?.main_text ?? p.description,
        secondary_text: p.structured_formatting?.secondary_text ?? '',
      })),
    })
  } catch (err) {
    console.error('Error in GET /api/places-autocomplete:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

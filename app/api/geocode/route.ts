import { NextRequest, NextResponse } from 'next/server'

interface GoogleGeocodeResult {
  status: string
  results: Array<{
    geometry: {
      location: {
        lat: number
        lng: number
      }
    }
    formatted_address: string
  }>
}

// GET /api/geocode?address=...
// Calls Google Maps Geocoding API server-side.
// Returns: { lat: number, lng: number, formatted_address: string } | { error: string }
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')

  if (!address || address.trim().length === 0) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Geocoding service not configured' }, { status: 503 })
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
    const res = await fetch(url)

    if (!res.ok) {
      return NextResponse.json({ error: 'Geocoding service unavailable' }, { status: 502 })
    }

    const json = (await res.json()) as GoogleGeocodeResult

    if (json.status === 'ZERO_RESULTS' || json.results.length === 0) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 })
    }

    if (json.status !== 'OK') {
      return NextResponse.json(
        { error: `Geocoding error: ${json.status}` },
        { status: 502 }
      )
    }

    const result = json.results[0]
    return NextResponse.json({
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address,
    })
  } catch (err) {
    console.error('Error in GET /api/geocode:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

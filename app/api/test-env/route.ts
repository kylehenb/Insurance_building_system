import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    googleMapsApiKeyExists: !!process.env.GOOGLE_MAPS_API_KEY,
    googleMapsApiKeyPrefix: process.env.GOOGLE_MAPS_API_KEY ? process.env.GOOGLE_MAPS_API_KEY.substring(0, 10) + '...' : 'not set',
    nextPublicGoogleMapsApiKeyExists: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    nextPublicGoogleMapsApiKeyPrefix: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.substring(0, 10) + '...' : 'not set',
  })
}

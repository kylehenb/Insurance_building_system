'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default marker icons in Leaflet with Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface TaggedSuburb {
  suburb: string
  state: string
  postcode: string
  lga?: string
}

interface ServiceAreaMapProps {
  suburbs: TaggedSuburb[]
  className?: string
}

export default function ServiceAreaMap({ suburbs, className = '' }: ServiceAreaMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])

  // Center of Western Australia
  const CENTER_LAT = -26.0
  const CENTER_LNG = 122.0
  const DEFAULT_ZOOM = 5

  useEffect(() => {
    if (!mapRef.current) return

    // Initialize map if it doesn't exist
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([CENTER_LAT, CENTER_LNG], DEFAULT_ZOOM)

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(mapInstanceRef.current)
    }

    const map = mapInstanceRef.current

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    // Group suburbs by postcode
    const postcodeGroups = new Map<string, TaggedSuburb[]>()
    suburbs.forEach(suburb => {
      if (!postcodeGroups.has(suburb.postcode)) {
        postcodeGroups.set(suburb.postcode, [])
      }
      postcodeGroups.get(suburb.postcode)!.push(suburb)
    })

    // Add markers for each postcode
    postcodeGroups.forEach((suburbsInPostcode, postcode) => {
      // Use a simple approximation for WA postcode coordinates
      // In production, you'd want actual geocoded coordinates
      const lat = CENTER_LAT + (Math.random() - 0.5) * 10
      const lng = CENTER_LNG + (Math.random() - 0.5) * 10

      const marker = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: '#c9a96e',
        color: '#1a1a1a',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.7,
      }).addTo(map)

      // Add popup with postcode and suburb count
      const suburbNames = suburbsInPostcode.map(s => s.suburb).slice(0, 5)
      const moreCount = suburbsInPostcode.length - 5
      const popupContent = `
        <div style="font-family: sans-serif; min-width: 150px;">
          <strong style="color: #1a1a1a;">Postcode: ${postcode}</strong>
          <div style="margin-top: 4px; color: #6b6763;">
            ${suburbNames.join(', ')}
            ${moreCount > 0 ? `<br>...and ${moreCount} more` : ''}
          </div>
          <div style="margin-top: 4px; font-size: 12px; color: #9e998f;">
            ${suburbsInPostcode.length} suburb${suburbsInPostcode.length !== 1 ? 's' : ''}
          </div>
        </div>
      `
      marker.bindPopup(popupContent)
      markersRef.current.push(marker)
    })

    // Fit bounds if there are markers
    if (markersRef.current.length > 0) {
      const group = L.featureGroup(markersRef.current)
      map.fitBounds(group.getBounds().pad(0.1))
    }

    // Cleanup
    return () => {
      // Don't destroy the map, just clear markers for re-render
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = []
    }
  }, [suburbs])

  return (
    <div className={`relative ${className}`}>
      <div ref={mapRef} className="w-full h-full min-h-[400px] rounded-lg border border-[#e8e4e0]" />
      {suburbs.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f5f2ee] rounded-lg">
          <div className="text-center">
            <p className="text-sm text-[#9e998f]">No suburbs selected</p>
            <p className="text-xs text-[#9e998f] mt-1">Add suburbs to see them on the map</p>
          </div>
        </div>
      )}
      {suburbs.length > 0 && (
        <div className="absolute bottom-4 left-4 bg-white border border-[#e8e4e0] rounded-lg px-3 py-2 shadow-lg">
          <p className="text-xs text-[#6b6763]">
            <span className="font-semibold text-[#1a1a1a]">{suburbs.length}</span> suburbs selected
          </p>
          <p className="text-xs text-[#9e998f] mt-1">
            {new Set(suburbs.map(s => s.postcode)).size} postcodes
          </p>
        </div>
      )}
    </div>
  )
}

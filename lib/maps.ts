/** Google Maps directions to an address: on a phone it opens the Maps app with the route ready */
export function mapsLink(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

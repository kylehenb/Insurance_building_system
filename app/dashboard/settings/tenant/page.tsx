'use client'

/**
 * Service Area Matching Logic (for /lib/scheduling/service-area-matcher.ts — future build)
 *
 * When an insurer order arrives with a property_address:
 * 1. Geocode the property address → lat/lng
 * 2. Check radius zones: if distance from lat/lng to any zone centre ≤ standard_km → Standard
 *    If > standard_km AND ≤ (standard_km + extended_km) → Extended (requires human approval)
 * 3. Check specific areas: if property postcode is in any SpecificArea.suburbs → Standard
 *    If postcode not in list but within extended_km of any tagged suburb centre → Extended
 * 4. If any match is Standard → mark order as Standard (most permissive wins)
 * 5. If all matches are Extended → mark order as Extended, flag for human approval
 * 6. If no match in standard areas → check active CAT areas
 * 7. If property state matches an active CatArea.states → mark as CAT (requires explicit approval)
 * 8. If no match at all → flag as Outside Service Area, block lodging until human overrides
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { AU_SUBURBS, type AuSuburb } from '@/lib/data/au-suburbs'
import { AU_LGA_PRESETS, type LgaPreset } from '@/lib/data/au-lgas'
import ServiceAreaMap from '@/components/maps/ServiceAreaMap'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type GeocodingState = 'idle' | 'loading' | 'success' | 'error'

// Extends AuSuburb with an optional LGA tag — set when added via LGA preset bulk-add.
// The lga field drives the group-display logic: suburbs sharing a complete LGA set
// render under a collapsible LGA header; once any suburb is removed the header disappears.
interface TaggedSuburb {
  suburb: string
  state: string
  postcode: string
  lga?: string
}

interface PlaceSuggestion {
  description: string
  place_id: string
  main_text: string
  secondary_text: string
}

interface RadiusZone {
  id: string
  label: string
  address: string
  lat: number | null
  lng: number | null
  standard_km: number
  extended_km: number
}

interface SpecificArea {
  id: string
  label: string
  suburbs: TaggedSuburb[]
  extended_km: number
}

interface CatArea {
  id: string
  label: string
  type: 'state' | 'region'
  states: string[]
  region_description: string
  notes: string
  is_active: boolean
}

interface ServiceAreaConfig {
  radius_zones: RadiusZone[]
  specific_areas: SpecificArea[]
  cat_areas: CatArea[]
}

interface ProfileFormData {
  name: string
  trading_name: string
  abn: string
  job_prefix: string
  job_sequence: number
  contact_email: string
  contact_phone: string
  address: string
  logo_storage_path: string
  alternative_logo_storage_path: string
  bsb: string
  account_number: string
  bank_name: string
  account_name: string
  plan: string
}

interface TenantApiResponse {
  tenant: {
    id: string
    name: string
    trading_name: string | null
    abn: string | null
    slug: string
    job_prefix: string
    job_sequence: number | null
    address: string | null
    contact_email: string | null
    contact_phone: string | null
    logo_storage_path: string | null
    alternative_logo_storage_path: string | null
    bsb: string | null
    account_number: string | null
    bank_name: string | null
    account_name: string | null
    plan: string | null
    service_area_config: ServiceAreaConfig | null
  }
  job_count: number
}

interface GeoResult {
  lat: number
  lng: number
  formatted_address: string
}

interface GeoError {
  error: string
}

const EMPTY_SERVICE_CONFIG: ServiceAreaConfig = {
  radius_zones: [],
  specific_areas: [],
  cat_areas: [],
}

const EMPTY_PROFILE: ProfileFormData = {
  name: '',
  trading_name: '',
  abn: '',
  job_prefix: '',
  job_sequence: 1,
  contact_email: '',
  contact_phone: '',
  address: '',
  logo_storage_path: '',
  alternative_logo_storage_path: '',
  bsb: '',
  account_number: '',
  bank_name: '',
  account_name: '',
  plan: '',
}

const AUSTRALIAN_STATES = ['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'NT', 'ACT']

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function isValidAbn(abn: string): boolean {
  return /^\d{11}$/.test(abn.replace(/\s/g, ''))
}

function generateCirclePath(
  lat: number,
  lng: number,
  radiusKm: number,
  numPoints = 24
): string {
  const points: string[] = []
  const latRad = (lat * Math.PI) / 180
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    const dlat = (radiusKm / 111.32) * Math.cos(angle)
    const dlng = (radiusKm / (111.32 * Math.cos(latRad))) * Math.sin(angle)
    points.push(`${(lat + dlat).toFixed(5)},${(lng + dlng).toFixed(5)}`)
  }
  return points.join('|')
}

function buildStaticMapUrl(
  lat: number,
  lng: number,
  standardKm: number,
  extendedKm: number,
  apiKey: string
): string {
  const standardPath = `path=color:0x2563EBCC|weight:2|fillcolor:0x2563EB22|${generateCirclePath(lat, lng, standardKm)}`
  const extendedPath = `path=color:0xD97706CC|weight:2|fillcolor:0xD9770622|${generateCirclePath(lat, lng, standardKm + extendedKm)}`
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=9&size=400x160&maptype=roadmap&${standardPath}&${extendedPath}&key=${apiKey}`
}

// ─────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────

export default function TenantSettingsPage() {
  const router = useRouter()

  // Auth state
  const [userId, setUserId] = useState<string | null>(null)

  // Data state
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [jobCount, setJobCount] = useState<number>(0)
  const [profileForm, setProfileForm] = useState<ProfileFormData>(EMPTY_PROFILE)
  const [serviceAreaConfig, setServiceAreaConfig] = useState<ServiceAreaConfig>(EMPTY_SERVICE_CONFIG)

  // Geocoding state (keyed by zone id)
  const [geocodingStates, setGeocodingStates] = useState<Record<string, GeocodingState>>({})

  // Save state
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [serviceAreaSaving, setServiceAreaSaving] = useState(false)
  const [serviceAreaSaveStatus, setServiceAreaSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Logo upload state
  const [logoUploading, setLogoUploading] = useState(false)
  const [alternativeLogoUploading, setAlternativeLogoUploading] = useState(false)

  // Section nav
  const [activeSection, setActiveSection] = useState<string>('tenant-profile')

  // ── Effect 1: get session ──────────────────────────────────────
  useEffect(() => {
    const getSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }
      setUserId(session.user.id)
    }
    getSession()
  }, [router])

  // ── Effect 2: fetch tenant data once userId is set ─────────────
  useEffect(() => {
    if (!userId) return

    const fetchTenantData = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/settings/tenant')
        if (!res.ok) throw new Error('Failed to fetch tenant')
        const data = (await res.json()) as TenantApiResponse

        const t = data.tenant
        setTenantId(t.id)
        setJobCount(data.job_count)
        setProfileForm({
          name: t.name ?? '',
          trading_name: t.trading_name ?? '',
          abn: t.abn ?? '',
          job_prefix: t.job_prefix ?? '',
          job_sequence: t.job_sequence ?? 1,
          contact_email: t.contact_email ?? '',
          contact_phone: t.contact_phone ?? '',
          address: t.address ?? '',
          logo_storage_path: t.logo_storage_path ?? '',
          alternative_logo_storage_path: t.alternative_logo_storage_path ?? '',
          bsb: t.bsb ?? '',
          account_number: t.account_number ?? '',
          bank_name: t.bank_name ?? '',
          account_name: t.account_name ?? '',
          plan: t.plan ?? '',
        })
        setServiceAreaConfig(t.service_area_config ?? EMPTY_SERVICE_CONFIG)
      } catch (err) {
        console.error('Error fetching tenant data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchTenantData()
  }, [userId])

  // ── Geocoding ──────────────────────────────────────────────────
  const geocodeAddress = useCallback(async (address: string, zoneId: string) => {
    if (!address.trim()) return
    setGeocodingStates((prev) => ({ ...prev, [zoneId]: 'loading' }))
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`)
      const json = (await res.json()) as GeoResult | GeoError
      if ('error' in json) throw new Error(json.error)
      const result = json as GeoResult
      setServiceAreaConfig((prev) => ({
        ...prev,
        radius_zones: prev.radius_zones.map((z) =>
          z.id === zoneId ? { ...z, lat: result.lat, lng: result.lng } : z
        ),
      }))
      setGeocodingStates((prev) => ({ ...prev, [zoneId]: 'success' }))
    } catch {
      setGeocodingStates((prev) => ({ ...prev, [zoneId]: 'error' }))
    }
  }, [])

  // ── Save Profile ───────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (profileForm.abn && !isValidAbn(profileForm.abn)) {
      setProfileSaveStatus('error')
      setTimeout(() => setProfileSaveStatus('idle'), 5000)
      return
    }
    setProfileSaving(true)
    try {
      const res = await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileForm.name,
          trading_name: profileForm.trading_name || null,
          abn: profileForm.abn ? profileForm.abn.replace(/\s/g, '') : null,
          job_prefix: profileForm.job_prefix.toUpperCase(),
          job_sequence: profileForm.job_sequence,
          contact_email: profileForm.contact_email || null,
          contact_phone: profileForm.contact_phone || null,
          address: profileForm.address || null,
          logo_storage_path: profileForm.logo_storage_path || null,
          alternative_logo_storage_path: profileForm.alternative_logo_storage_path || null,
          bsb: profileForm.bsb || null,
          account_number: profileForm.account_number || null,
          bank_name: profileForm.bank_name || null,
          account_name: profileForm.account_name || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setProfileSaveStatus('saved')
      setTimeout(() => setProfileSaveStatus('idle'), 3000)
    } catch {
      setProfileSaveStatus('error')
      setTimeout(() => setProfileSaveStatus('idle'), 5000)
    } finally {
      setProfileSaving(false)
    }
  }

  // ── Save Service Areas ─────────────────────────────────────────
  const handleSaveServiceAreas = async () => {
    setServiceAreaSaving(true)
    try {
      const res = await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_area_config: serviceAreaConfig }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setServiceAreaSaveStatus('saved')
      setTimeout(() => setServiceAreaSaveStatus('idle'), 3000)
    } catch {
      setServiceAreaSaveStatus('error')
      setTimeout(() => setServiceAreaSaveStatus('idle'), 5000)
    } finally {
      setServiceAreaSaving(false)
    }
  }

  // ── Logo Upload ────────────────────────────────────────────────
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !tenantId) return
    setLogoUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `tenants/${tenantId}/logo/logo.${ext}`
      const { error } = await supabase.storage
        .from('tenant-assets') // bucket must exist in Supabase Storage
        .upload(path, file, { upsert: true })
      if (error) throw error
      setProfileForm((prev) => ({ ...prev, logo_storage_path: path }))
      // Auto-save to persist the path to database
      await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_storage_path: path }),
      })
    } catch (err) {
      console.error('Logo upload failed:', err)
    } finally {
      setLogoUploading(false)
    }
  }

  const handleAlternativeLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !tenantId) return
    setAlternativeLogoUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `tenants/${tenantId}/logo/alternative-logo.${ext}`
      const { error } = await supabase.storage
        .from('tenant-assets') // bucket must exist in Supabase Storage
        .upload(path, file, { upsert: true })
      if (error) throw error
      setProfileForm((prev) => ({ ...prev, alternative_logo_storage_path: path }))
      // Auto-save to persist the path to database
      await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alternative_logo_storage_path: path }),
      })
    } catch (err) {
      console.error('Alternative logo upload failed:', err)
    } finally {
      setAlternativeLogoUploading(false)
    }
  }

  // ── Radius Zone handlers ───────────────────────────────────────
  const addRadiusZone = () => {
    const id = crypto.randomUUID()
    setServiceAreaConfig((prev) => ({
      ...prev,
      radius_zones: [
        ...prev.radius_zones,
        { id, label: '', address: '', lat: null, lng: null, standard_km: 50, extended_km: 30 },
      ],
    }))
  }

  const updateRadiusZone = (updated: RadiusZone) => {
    setServiceAreaConfig((prev) => ({
      ...prev,
      radius_zones: prev.radius_zones.map((z) => (z.id === updated.id ? updated : z)),
    }))
  }

  const deleteRadiusZone = (id: string) => {
    if (!window.confirm('Delete this radius zone?')) return
    setServiceAreaConfig((prev) => ({
      ...prev,
      radius_zones: prev.radius_zones.filter((z) => z.id !== id),
    }))
    setGeocodingStates((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // ── Specific Area handlers ─────────────────────────────────────
  const addSpecificArea = () => {
    setServiceAreaConfig((prev) => ({
      ...prev,
      specific_areas: [
        ...prev.specific_areas,
        { id: crypto.randomUUID(), label: '', suburbs: [], extended_km: 20 },
      ],
    }))
  }

  const updateSpecificArea = (updated: SpecificArea) => {
    setServiceAreaConfig((prev) => ({
      ...prev,
      specific_areas: prev.specific_areas.map((a) => (a.id === updated.id ? updated : a)),
    }))
  }

  const deleteSpecificArea = (id: string) => {
    if (!window.confirm('Delete this specific area?')) return
    setServiceAreaConfig((prev) => ({
      ...prev,
      specific_areas: prev.specific_areas.filter((a) => a.id !== id),
    }))
  }

  // ── CAT Area handlers ──────────────────────────────────────────
  const addCatArea = () => {
    setServiceAreaConfig((prev) => ({
      ...prev,
      cat_areas: [
        ...prev.cat_areas,
        {
          id: crypto.randomUUID(),
          label: '',
          type: 'state',
          states: [],
          region_description: '',
          notes: '',
          is_active: false,
        },
      ],
    }))
  }

  const updateCatArea = (updated: CatArea) => {
    setServiceAreaConfig((prev) => ({
      ...prev,
      cat_areas: prev.cat_areas.map((a) => (a.id === updated.id ? updated : a)),
    }))
  }

  const deleteCatArea = (id: string) => {
    if (!window.confirm('Delete this CAT area?')) return
    setServiceAreaConfig((prev) => ({
      ...prev,
      cat_areas: prev.cat_areas.filter((a) => a.id !== id),
    }))
  }

  // ── Section nav ────────────────────────────────────────────────
  const scrollToSection = (id: string) => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Derived ────────────────────────────────────────────────────
  const activeCatAreas = serviceAreaConfig.cat_areas.filter((a) => a.is_active)
  const logoDisplayUrl =
    profileForm.logo_storage_path && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${profileForm.logo_storage_path}`
      : null
  const alternativeLogoDisplayUrl =
    profileForm.alternative_logo_storage_path && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${profileForm.alternative_logo_storage_path}`
      : null

  // ── Loading skeleton ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f5f2ee]">
        <div className="text-[#9e998f] text-sm">Loading...</div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f5f2ee] pb-20">
      {/* CAT Active Banner */}
      {activeCatAreas.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
          <p className="text-sm text-amber-800">
            ⚠ CAT mode active —{' '}
            {activeCatAreas.map((a) => a.label).join(', ')} is live. Orders
            outside standard service areas will be matched against CAT zones.
          </p>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="mb-8">
          <p className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            Settings
          </p>
          <h1 className="text-3xl font-semibold text-[#1a1a1a]">Tenant Settings</h1>
          <p className="text-sm text-[#9e998f] mt-1">
            Business profile, job numbering, and service area configuration.
          </p>
        </div>

        <div className="flex gap-8 items-start">
          {/* ── Left sticky nav ── */}
          <div className="w-44 flex-shrink-0">
            <nav className="sticky top-8 space-y-1">
              <NavItem
                id="tenant-profile"
                label="Tenant Profile"
                active={activeSection === 'tenant-profile'}
                onClick={scrollToSection}
              />
              <NavItem
                id="service-areas"
                label="Service Areas"
                active={
                  activeSection === 'service-areas' ||
                  activeSection === 'radius-zones' ||
                  activeSection === 'specific-areas' ||
                  activeSection === 'cat-areas'
                }
                onClick={scrollToSection}
              />
              {(serviceAreaConfig.radius_zones.length > 0 ||
                serviceAreaConfig.specific_areas.length > 0 ||
                serviceAreaConfig.cat_areas.length > 0) && (
                <div className="pl-4 space-y-1">
                  <NavItem
                    id="radius-zones"
                    label="Radius Zones"
                    active={activeSection === 'radius-zones'}
                    onClick={scrollToSection}
                    small
                  />
                  <NavItem
                    id="specific-areas"
                    label="Specific Areas"
                    active={activeSection === 'specific-areas'}
                    onClick={scrollToSection}
                    small
                  />
                  <NavItem
                    id="cat-areas"
                    label="CAT Areas"
                    active={activeSection === 'cat-areas'}
                    onClick={scrollToSection}
                    small
                  />
                </div>
              )}
            </nav>
          </div>

          {/* ── Right content ── */}
          <div className="flex-1 min-w-0 space-y-8">
            {/* ════════════════════════════════════════════════════
                SECTION 1 — TENANT PROFILE
            ════════════════════════════════════════════════════ */}
            <section id="tenant-profile" className="scroll-mt-6">
              <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
                <div className="mb-6">
                  <p className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                    Account
                  </p>
                  <h2 className="text-xl font-semibold text-[#1a1a1a]">Tenant Profile</h2>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  {/* Business name */}
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Business name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={profileForm.name}
                      onChange={(e) =>
                        setProfileForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                    />
                  </div>

                  {/* Trading name */}
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Trading name
                    </label>
                    <input
                      type="text"
                      value={profileForm.trading_name}
                      onChange={(e) =>
                        setProfileForm((prev) => ({ ...prev, trading_name: e.target.value }))
                      }
                      placeholder="Optional"
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                    />
                  </div>

                  {/* ABN */}
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      ABN
                    </label>
                    <input
                      type="text"
                      value={profileForm.abn}
                      onChange={(e) =>
                        setProfileForm((prev) => ({ ...prev, abn: e.target.value }))
                      }
                      placeholder="11 digits"
                      maxLength={14}
                      className={`w-full border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] ${
                        profileForm.abn && !isValidAbn(profileForm.abn)
                          ? 'border-red-400'
                          : 'border-[#e8e4e0]'
                      }`}
                    />
                    {profileForm.abn && !isValidAbn(profileForm.abn) && (
                      <p className="text-xs text-red-500 mt-1">ABN must be 11 digits</p>
                    )}
                  </div>

                  {/* Plan badge */}
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Plan
                    </label>
                    <div className="flex items-center h-9">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#f5f2ee] border border-[#e8e4e0] text-[#3a3530] uppercase tracking-wide">
                        {profileForm.plan || 'Unknown'}
                      </span>
                      <span className="ml-2 text-xs text-[#9e998f]">Read-only</span>
                    </div>
                  </div>

                  {/* Job prefix */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Job number prefix
                    </label>
                    <input
                      type="text"
                      value={profileForm.job_prefix}
                      onChange={(e) =>
                        setProfileForm((prev) => ({
                          ...prev,
                          job_prefix: e.target.value.toUpperCase().slice(0, 6),
                        }))
                      }
                      maxLength={6}
                      placeholder="e.g. IRC"
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white font-mono focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                    />
                    <p className="text-xs text-amber-600 mt-1">
                      Changing this prefix affects future job numbers only — existing job numbers
                      are not renamed.
                    </p>
                  </div>

                  {/* Starting job number */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Starting job number
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={profileForm.job_sequence}
                      onChange={(e) =>
                        setProfileForm((prev) => ({
                          ...prev,
                          job_sequence: parseInt(e.target.value) || 1,
                        }))
                      }
                      disabled={jobCount > 0}
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] disabled:bg-[#f5f2ee] disabled:text-[#9e998f] disabled:cursor-not-allowed"
                    />
                    {jobCount > 0 ? (
                      <p className="text-xs text-[#9e998f] mt-1">
                        Locked — {jobCount} job{jobCount !== 1 ? 's' : ''} already created.
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 mt-1">
                        Only increase — decreasing may cause duplicate job numbers.
                      </p>
                    )}
                  </div>

                  {/* Contact email */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Contact email
                    </label>
                    <input
                      type="email"
                      value={profileForm.contact_email}
                      onChange={(e) =>
                        setProfileForm((prev) => ({ ...prev, contact_email: e.target.value }))
                      }
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                    />
                  </div>

                  {/* Contact phone */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Contact phone
                    </label>
                    <input
                      type="tel"
                      value={profileForm.contact_phone}
                      onChange={(e) =>
                        setProfileForm((prev) => ({ ...prev, contact_phone: e.target.value }))
                      }
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                    />
                  </div>

                  {/* Business address */}
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                      Business address
                    </label>
                    <textarea
                      rows={2}
                      value={profileForm.address}
                      onChange={(e) =>
                        setProfileForm((prev) => ({ ...prev, address: e.target.value }))
                      }
                      className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] resize-none"
                    />
                  </div>

                  {/* Logo upload */}
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">
                      Logo
                    </label>
                    <div className="flex items-start gap-6">
                      {logoDisplayUrl ? (
                        <div className="flex-shrink-0">
                          <img
                            src={logoDisplayUrl}
                            alt="Company logo"
                            className="h-24 w-auto border border-[#e8e4e0] rounded-lg object-contain bg-white p-2 shadow-sm"
                            onError={(e) => {
                              console.error('Failed to load logo image:', logoDisplayUrl)
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex-shrink-0 w-24 h-24 border-2 border-dashed border-[#e8e4e0] rounded-lg bg-[#f5f2ee] flex items-center justify-center">
                          <span className="text-xs text-[#9e998f]">No logo</span>
                        </div>
                      )}
                      <div className="flex-1">
                        <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-[#3a3530] border border-[#e8e4e0] rounded px-3 py-1.5 hover:bg-[#f5f2ee] transition-colors">
                          {logoUploading ? 'Uploading...' : logoDisplayUrl ? 'Replace logo' : 'Upload logo'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLogoUpload}
                            disabled={logoUploading || !tenantId}
                          />
                        </label>
                        <p className="text-xs text-[#9e998f] mt-1">
                          PNG, JPG or SVG. Stored to tenant-assets bucket.
                        </p>
                        {profileForm.logo_storage_path && (
                          <p className="text-xs text-green-600 mt-1">
                            ✓ Logo uploaded and saved
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Alternative logo upload */}
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">
                      Alternative Logo
                    </label>
                    <div className="flex items-start gap-6">
                      {alternativeLogoDisplayUrl ? (
                        <div className="flex-shrink-0">
                          <img
                            src={alternativeLogoDisplayUrl}
                            alt="Alternative company logo"
                            className="h-24 w-auto border border-[#e8e4e0] rounded-lg object-contain bg-white p-2 shadow-sm"
                            onError={(e) => {
                              console.error('Failed to load alternative logo image:', alternativeLogoDisplayUrl)
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex-shrink-0 w-24 h-24 border-2 border-dashed border-[#e8e4e0] rounded-lg bg-[#f5f2ee] flex items-center justify-center">
                          <span className="text-xs text-[#9e998f]">No logo</span>
                        </div>
                      )}
                      <div className="flex-1">
                        <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-[#3a3530] border border-[#e8e4e0] rounded px-3 py-1.5 hover:bg-[#f5f2ee] transition-colors">
                          {alternativeLogoUploading ? 'Uploading...' : alternativeLogoDisplayUrl ? 'Replace alternative logo' : 'Upload alternative logo'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleAlternativeLogoUpload}
                            disabled={alternativeLogoUploading || !tenantId}
                          />
                        </label>
                        <p className="text-xs text-[#9e998f] mt-1">
                          Optional secondary logo (e.g., for dark mode or specialized documents).
                        </p>
                        {profileForm.alternative_logo_storage_path && (
                          <p className="text-xs text-green-600 mt-1">
                            ✓ Alternative logo uploaded and saved
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Financial details */}
                  <div className="col-span-2 mt-6 pt-6 border-t border-[#e8e4e0]">
                    <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-4">
                      Financial Details
                    </label>
                    <div className="grid grid-cols-2 gap-5">
                      {/* BSB */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                          BSB
                        </label>
                        <input
                          type="text"
                          value={profileForm.bsb}
                          onChange={(e) =>
                            setProfileForm((prev) => ({ ...prev, bsb: e.target.value }))
                          }
                          placeholder="6 digits"
                          maxLength={6}
                          className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white font-mono focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                        />
                      </div>

                      {/* Account Number */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                          Account Number
                        </label>
                        <input
                          type="text"
                          value={profileForm.account_number}
                          onChange={(e) =>
                            setProfileForm((prev) => ({ ...prev, account_number: e.target.value }))
                          }
                          placeholder="Account number"
                          className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white font-mono focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                        />
                      </div>

                      {/* Bank Name */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                          Bank Name
                        </label>
                        <input
                          type="text"
                          value={profileForm.bank_name}
                          onChange={(e) =>
                            setProfileForm((prev) => ({ ...prev, bank_name: e.target.value }))
                          }
                          placeholder="e.g. Commonwealth Bank"
                          className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                        />
                      </div>

                      {/* Account Name */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                          Account Name
                        </label>
                        <input
                          type="text"
                          value={profileForm.account_name}
                          onChange={(e) =>
                            setProfileForm((prev) => ({ ...prev, account_name: e.target.value }))
                          }
                          placeholder="Account holder name"
                          className="w-full border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <div className="mt-6 flex items-center justify-between pt-4 border-t border-[#e8e4e0]">
                  {profileSaveStatus !== 'idle' && (
                    <span
                      className={`text-sm ${
                        profileSaveStatus === 'saved' ? 'text-green-600' : 'text-red-500'
                      }`}
                    >
                      {profileSaveStatus === 'saved'
                        ? 'Saved ✓'
                        : profileForm.abn && !isValidAbn(profileForm.abn)
                        ? 'Invalid ABN — must be 11 digits'
                        : 'Error saving — try again'}
                    </span>
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={handleSaveProfile}
                      disabled={profileSaving}
                      className="bg-[#c9a96e] text-white px-5 py-2 rounded text-sm font-medium hover:bg-[#b8965e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {profileSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ════════════════════════════════════════════════════
                SECTION 2 — SERVICE AREAS
            ════════════════════════════════════════════════════ */}
            <section id="service-areas" className="scroll-mt-6">
              <div className="mb-2">
                <p className="text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                  Operations
                </p>
                <h2 className="text-xl font-semibold text-[#1a1a1a]">Service Areas</h2>
                <p className="text-sm text-[#9e998f] mt-1">
                  Configure where your team operates. Incoming insurer orders will be matched
                  against these zones to determine service type (Standard, Extended, CAT, or
                  Outside Area).
                </p>
              </div>

              {/* ── 2a. Radius-Based Zones ── */}
              <div id="radius-zones" className="scroll-mt-6 mt-6">
                <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-1">
                    Radius-Based Zones
                  </h3>
                  <p className="text-sm text-[#9e998f] mb-4">
                    Define one or more base locations (office, depot). Jobs within the standard
                    radius are Standard service. Jobs in the outer ring are Extended service and
                    require approval before lodging.
                  </p>

                  <div className="space-y-4">
                    {serviceAreaConfig.radius_zones.map((zone) => (
                      <RadiusZoneCard
                        key={zone.id}
                        zone={zone}
                        geocodingState={geocodingStates[zone.id] ?? 'idle'}
                        onChange={updateRadiusZone}
                        onDelete={() => deleteRadiusZone(zone.id)}
                        onGeocodeBlur={geocodeAddress}
                        mapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''}
                      />
                    ))}
                  </div>

                  <button
                    onClick={addRadiusZone}
                    className="mt-4 text-sm text-[#c9a96e] hover:text-[#b8965e] font-medium"
                  >
                    + Add another base location
                  </button>
                </div>
              </div>

              {/* ── 2b. Specific Service Areas ── */}
              <div id="specific-areas" className="scroll-mt-6 mt-4">
                <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-1">
                    Specific Service Areas
                  </h3>
                  <p className="text-sm text-[#9e998f] mb-4">
                    Tag specific suburbs and postcodes. Useful for corridor-style coverage areas
                    or specific town groupings outside a simple radius.
                  </p>

                  <div className="space-y-4">
                    {serviceAreaConfig.specific_areas.map((area) => (
                      <SpecificAreaCard
                        key={area.id}
                        area={area}
                        onChange={updateSpecificArea}
                        onDelete={() => deleteSpecificArea(area.id)}
                      />
                    ))}
                  </div>

                  {/* Interactive Map Visualization */}
                  {serviceAreaConfig.specific_areas.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-[#e8e4e0]">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-[#1a1a1a]">Service Area Map</h4>
                        <span className="text-xs text-[#9e998f]">
                          {serviceAreaConfig.specific_areas.reduce((sum, area) => sum + area.suburbs.length, 0)} suburbs across {serviceAreaConfig.specific_areas.length} areas
                        </span>
                      </div>
                      <ServiceAreaMap
                        suburbs={serviceAreaConfig.specific_areas.flatMap(area => area.suburbs)}
                        className="h-[400px]"
                      />
                    </div>
                  )}

                  <button
                    onClick={addSpecificArea}
                    className="mt-4 text-sm text-[#c9a96e] hover:text-[#b8965e] font-medium"
                  >
                    + Add specific area
                  </button>
                </div>
              </div>

              {/* ── 2c. CAT Service Areas ── */}
              <div id="cat-areas" className="scroll-mt-6 mt-4">
                <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
                  <h3 className="text-base font-semibold text-[#1a1a1a] mb-1">
                    CAT Service Areas
                  </h3>
                  <p className="text-sm text-[#9e998f] mb-4">
                    Areas activated only during declared catastrophe events. Toggle an area active
                    to apply it to incoming orders. Inactive CAT areas are saved but not applied.
                  </p>

                  <div className="space-y-4">
                    {serviceAreaConfig.cat_areas.map((area) => (
                      <CatAreaCard
                        key={area.id}
                        area={area}
                        onChange={updateCatArea}
                        onDelete={() => deleteCatArea(area.id)}
                      />
                    ))}
                  </div>

                  <button
                    onClick={addCatArea}
                    className="mt-4 text-sm text-[#c9a96e] hover:text-[#b8965e] font-medium"
                  >
                    + Add CAT area
                  </button>
                </div>
              </div>

              {/* Save Service Areas button */}
              <div className="mt-4 bg-white border border-[#e8e4e0] rounded-lg px-6 py-4 flex items-center justify-between">
                {serviceAreaSaveStatus !== 'idle' && (
                  <span
                    className={`text-sm ${
                      serviceAreaSaveStatus === 'saved' ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {serviceAreaSaveStatus === 'saved'
                      ? 'Saved ✓'
                      : 'Error saving — try again'}
                  </span>
                )}
                <div className="ml-auto">
                  <button
                    onClick={handleSaveServiceAreas}
                    disabled={serviceAreaSaving}
                    className="bg-[#c9a96e] text-white px-5 py-2 rounded text-sm font-medium hover:bg-[#b8965e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {serviceAreaSaving ? 'Saving...' : 'Save Service Areas'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// NavItem
// ─────────────────────────────────────────────────────────────────

function NavItem({
  id,
  label,
  active,
  onClick,
  small = false,
}: {
  id: string
  label: string
  active: boolean
  onClick: (id: string) => void
  small?: boolean
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
        small ? 'text-xs' : ''
      } ${
        active
          ? 'text-[#c9a96e] bg-[#fdf8f0] font-medium'
          : 'text-[#6b6763] hover:text-[#1a1a1a] hover:bg-[#f5f2ee]'
      }`}
    >
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// RadiusZoneCard
// ─────────────────────────────────────────────────────────────────

function RadiusZoneCard({
  zone,
  geocodingState,
  onChange,
  onDelete,
  onGeocodeBlur,
  mapsApiKey,
}: {
  zone: RadiusZone
  geocodingState: GeocodingState
  onChange: (updated: RadiusZone) => void
  onDelete: () => void
  onGeocodeBlur: (address: string, zoneId: string) => void
  mapsApiKey: string
}) {
  const hasCoords = zone.lat !== null && zone.lng !== null
  const staticMapUrl =
    hasCoords && mapsApiKey
      ? buildStaticMapUrl(zone.lat!, zone.lng!, zone.standard_km, zone.extended_km, mapsApiKey)
      : null

  return (
    <div className="border border-[#e8e4e0] rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 mr-4">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            Zone label
          </label>
          <input
            type="text"
            value={zone.label}
            onChange={(e) => onChange({ ...zone, label: e.target.value })}
            placeholder="e.g. Perth CBD Office"
            className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
          />
        </div>
        <button
          onClick={onDelete}
          className="text-[#b0a89e] hover:text-red-500 text-lg leading-none mt-5 transition-colors"
          title="Delete zone"
        >
          ×
        </button>
      </div>

      {/* Base address — fuzzy search via Places Autocomplete */}
      <div className="mb-3">
        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
          Base address
        </label>
        <AddressSearch
          value={zone.address}
          onChange={(address) => onChange({ ...zone, address, lat: null, lng: null })}
          onSelect={(address) => onGeocodeBlur(address, zone.id)}
          geocodingState={geocodingState}
        />
      </div>

      {/* Radius inputs */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            Standard service radius (km)
          </label>
          <input
            type="number"
            min={1}
            value={zone.standard_km}
            onChange={(e) => onChange({ ...zone, standard_km: parseInt(e.target.value) || 1 })}
            className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
          />
          <p className="text-xs text-[#9e998f] mt-0.5">
            Jobs within this distance are Standard service.
          </p>
        </div>
        <div className="bg-[#f0f7ff] rounded-lg p-2.5">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            Extended service radius (km)
          </label>
          <input
            type="number"
            min={1}
            value={zone.extended_km}
            onChange={(e) => onChange({ ...zone, extended_km: parseInt(e.target.value) || 1 })}
            className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
          />
          <p className="text-xs text-[#9e998f] mt-0.5">
            Beyond standard radius, within this additional distance — Extended, requires approval.
          </p>
        </div>
      </div>

      {/* Map preview */}
      {staticMapUrl ? (
        <img
          src={staticMapUrl}
          alt={`Map for ${zone.label || 'zone'}`}
          width={400}
          height={160}
          className="w-full max-w-[400px] h-[160px] object-cover rounded border border-[#e8e4e0]"
        />
      ) : (
        <div className="w-full max-w-[400px] h-[160px] bg-[#f5f2ee] rounded border border-[#e8e4e0] flex items-center justify-center">
          <span className="text-xs text-[#9e998f]">
            {zone.address.trim()
              ? geocodingState === 'loading'
                ? 'Geocoding address…'
                : 'Select an address from the search dropdown to geocode'
              : 'Enter a base address to see a map preview'}
          </span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// computeSuburbGroups — used by SpecificAreaCard
// ─────────────────────────────────────────────────────────────────

function computeSuburbGroups(suburbs: TaggedSuburb[]) {
  // Collect unique LGA names that appear in the current suburb list
  const lgaNames = [...new Set(suburbs.filter((s) => s.lga).map((s) => s.lga!))]
  const completeLgaGroups: { lga: string; suburbs: TaggedSuburb[] }[] = []
  const completeLgaKeys = new Set<string>()

  for (const lgaName of lgaNames) {
    const preset = AU_LGA_PRESETS.find((p) => p.lga === lgaName)
    if (!preset) continue
    // LGA group is only shown when ALL preset suburbs are still present
    const isComplete = preset.suburbs.every((ps) =>
      suburbs.some((s) => s.suburb === ps.suburb && s.postcode === ps.postcode)
    )
    if (isComplete) {
      const lgaSuburbs = suburbs.filter((s) => s.lga === lgaName)
      completeLgaGroups.push({ lga: lgaName, suburbs: lgaSuburbs })
      lgaSuburbs.forEach((s) => completeLgaKeys.add(`${s.suburb}-${s.postcode}`))
    }
  }

  // Individual suburbs = everything not in a complete LGA group
  const individualSuburbs = suburbs.filter(
    (s) => !completeLgaKeys.has(`${s.suburb}-${s.postcode}`)
  )

  return { completeLgaGroups, individualSuburbs }
}

// ─────────────────────────────────────────────────────────────────
// SpecificAreaCard
// ─────────────────────────────────────────────────────────────────

function SpecificAreaCard({
  area,
  onChange,
  onDelete,
}: {
  area: SpecificArea
  onChange: (updated: SpecificArea) => void
  onDelete: () => void
}) {
  const [showLgaSelector, setShowLgaSelector] = useState(false)
  const [lgaQuery, setLgaQuery] = useState('')
  const lgaSelectorRef = useRef<HTMLDivElement>(null)

  // Close LGA selector on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (lgaSelectorRef.current && !lgaSelectorRef.current.contains(e.target as Node)) {
        setShowLgaSelector(false)
        setLgaQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const removeSuburb = (suburb: TaggedSuburb) => {
    onChange({
      ...area,
      suburbs: area.suburbs.filter(
        (s) => !(s.suburb === suburb.suburb && s.postcode === suburb.postcode)
      ),
    })
  }

  const addLga = (preset: LgaPreset) => {
    // Add all preset suburbs not already in the list, tagged with the LGA name
    const newSuburbs: TaggedSuburb[] = preset.suburbs
      .filter(
        (ps) => !area.suburbs.some((s) => s.suburb === ps.suburb && s.postcode === ps.postcode)
      )
      .map((ps) => ({ ...ps, lga: preset.lga }))
    onChange({ ...area, suburbs: [...area.suburbs, ...newSuburbs] })
    setShowLgaSelector(false)
    setLgaQuery('')
  }

  const { completeLgaGroups, individualSuburbs } = computeSuburbGroups(area.suburbs)

  const filteredLgas = AU_LGA_PRESETS.filter((p) =>
    p.lga.toLowerCase().includes(lgaQuery.toLowerCase())
  )

  return (
    <div className="border border-[#e8e4e0] rounded-lg p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 mr-4">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            Area label
          </label>
          <input
            type="text"
            value={area.label}
            onChange={(e) => onChange({ ...area, label: e.target.value })}
            placeholder="e.g. South West Corridor"
            className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
          />
        </div>
        <button
          onClick={onDelete}
          className="text-[#b0a89e] hover:text-red-500 text-lg leading-none mt-5 transition-colors"
          title="Delete area"
        >
          ×
        </button>
      </div>

      {/* Suburbs section */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold">
            Suburbs / Postcodes
          </label>
          {area.suburbs.length > 0 && (
            <span className="text-xs bg-[#f5f2ee] border border-[#e8e4e0] px-2 py-0.5 rounded-full text-[#6b6763]">
              {area.suburbs.length} suburb{area.suburbs.length !== 1 ? 's' : ''} tagged
            </span>
          )}
        </div>

        {/* Complete LGA group cards */}
        {completeLgaGroups.length > 0 && (
          <div className="space-y-2 mb-2">
            {completeLgaGroups.map(({ lga, suburbs: lgaSuburbs }) => (
              <div
                key={lga}
                className="border border-[#c9a96e] rounded-lg p-2.5 bg-[#fdf8f0]"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[#c9a96e]">{lga}</span>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove all ${lgaSuburbs.length} suburbs in ${lga}?`)) {
                        onChange({
                          ...area,
                          suburbs: area.suburbs.filter((s) => s.lga !== lga),
                        })
                      }
                    }}
                    className="text-[10px] text-[#9e998f] hover:text-red-500 transition-colors"
                  >
                    Remove LGA
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {lgaSuburbs.map((s) => (
                    <span
                      key={`${s.suburb}-${s.postcode}`}
                      className="inline-flex items-center gap-1 bg-white border border-[#e8e4e0] text-[#3a3530] text-xs px-2 py-0.5 rounded"
                    >
                      {s.suburb} {s.postcode}
                      <button
                        onClick={() => removeSuburb(s)}
                        className="text-[#9e998f] hover:text-[#1a1a1a] leading-none"
                        title={`Remove ${s.suburb} (will break LGA group)`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Individual suburb chips (non-LGA or partial LGA) */}
        {individualSuburbs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {individualSuburbs.map((s) => (
              <span
                key={`${s.suburb}-${s.postcode}`}
                className="inline-flex items-center gap-1 bg-[#f5f2ee] border border-[#e8e4e0] text-[#3a3530] text-xs px-2 py-0.5 rounded"
              >
                {s.suburb} {s.postcode}
                <button
                  onClick={() => removeSuburb(s)}
                  className="text-[#9e998f] hover:text-[#1a1a1a] leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        <SuburbAutocomplete
          selected={area.suburbs}
          onAdd={(suburb) => onChange({ ...area, suburbs: [...area.suburbs, suburb] })}
        />

        {/* LGA bulk-add */}
        <div ref={lgaSelectorRef} className="relative mt-2">
          <button
            onClick={() => setShowLgaSelector(!showLgaSelector)}
            className="text-xs text-[#6b6763] border border-[#e8e4e0] rounded px-2.5 py-1 hover:bg-[#f5f2ee] transition-colors"
          >
            + Add by LGA
          </button>
          {showLgaSelector && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-[#e8e4e0] rounded-lg shadow-lg z-30">
              <div className="p-2 border-b border-[#e8e4e0]">
                <input
                  type="text"
                  value={lgaQuery}
                  onChange={(e) => setLgaQuery(e.target.value)}
                  placeholder="Search LGA name…"
                  autoFocus
                  className="w-full text-xs border border-[#e8e4e0] rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {filteredLgas.length === 0 ? (
                  <p className="text-xs text-[#9e998f] px-3 py-2">No LGAs match</p>
                ) : (
                  filteredLgas.map((preset) => {
                    const alreadyAdded = preset.suburbs.every((ps) =>
                      area.suburbs.some((s) => s.suburb === ps.suburb && s.postcode === ps.postcode)
                    )
                    return (
                      <button
                        key={preset.lga}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          if (!alreadyAdded) addLga(preset)
                        }}
                        disabled={alreadyAdded}
                        className={`block w-full text-left px-3 py-2 text-xs border-b border-[#f5f2ee] last:border-0 transition-colors ${
                          alreadyAdded
                            ? 'text-[#9e998f] cursor-not-allowed'
                            : 'text-[#1a1a1a] hover:bg-[#f5f2ee]'
                        }`}
                      >
                        <span className="font-medium">{preset.lga}</span>
                        <span className="text-[#9e998f] ml-1">
                          {alreadyAdded ? '✓ added' : `${preset.suburbs.length} suburbs`}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Extended buffer */}
      <div className="bg-[#f0f7ff] rounded-lg p-2.5">
        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
          Extended service buffer (km)
        </label>
        <input
          type="number"
          min={0}
          value={area.extended_km}
          onChange={(e) => onChange({ ...area, extended_km: parseInt(e.target.value) || 0 })}
          className="w-32 border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
        />
        <p className="text-xs text-[#9e998f] mt-0.5">
          Jobs outside tagged suburbs but within this distance from any tagged suburb boundary are
          Extended service. Uses suburb centre coordinates as the reference point.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// SuburbAutocomplete
// ─────────────────────────────────────────────────────────────────

// SuburbAutocomplete is a pure search-and-add input.
// Tag display is handled by SpecificAreaCard (LGA groups + individual chips).
function SuburbAutocomplete({
  selected,
  onAdd,
}: {
  selected: TaggedSuburb[]
  onAdd: (suburb: TaggedSuburb) => void
}) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = query.trim()
    ? AU_SUBURBS.filter((s) => {
        const text = `${s.suburb} ${s.state} ${s.postcode}`.toLowerCase()
        const alreadySelected = selected.some(
          (sel) => sel.suburb === s.suburb && sel.postcode === s.postcode
        )
        return !alreadySelected && text.includes(query.toLowerCase())
      }).slice(0, 12)
    : []

  const handleSelect = (suburb: AuSuburb) => {
    onAdd(suburb) // AuSuburb satisfies TaggedSuburb (lga is optional)
    setQuery('')
    setShowDropdown(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        placeholder="Search suburb name or postcode to add…"
        className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#e8e4e0] rounded shadow-lg z-20 max-h-48 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={`${s.suburb}-${s.postcode}`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(s)
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-[#f5f2ee] text-[#1a1a1a]"
            >
              {s.suburb}{' '}
              <span className="text-[#9e998f]">
                {s.state} {s.postcode}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// AddressSearch — fuzzy Australian address search for radius zones
// ─────────────────────────────────────────────────────────────────

function AddressSearch({
  value,
  onChange,
  onSelect,
  geocodingState,
}: {
  value: string
  onChange: (address: string) => void
  onSelect: (address: string) => void
  geocodingState: GeocodingState
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchSuggestions = async (input: string) => {
    if (input.trim().length < 3) {
      setSuggestions([])
      return
    }
    try {
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(input)}`)
      if (!res.ok) return
      const data = (await res.json()) as { suggestions: PlaceSuggestion[] }
      setSuggestions(data.suggestions ?? [])
      setShowDropdown(true)
    } catch {
      setSuggestions([])
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300)
  }

  const handleSelect = (suggestion: PlaceSuggestion) => {
    onChange(suggestion.description)
    onSelect(suggestion.description)
    setSuggestions([])
    setShowDropdown(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        {/* Search icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg
            className="w-4 h-4 text-[#9e998f]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          placeholder="Search any Australian address (street, suburb, postcode)…"
          className="w-full border border-[#e8e4e0] rounded pl-10 pr-32 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
        />
        
        {/* Right side indicators */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          {/* Google Places badge */}
          {suggestions.length > 0 && geocodingState === 'idle' && (
            <span className="text-[10px] text-[#9e998f] bg-[#f5f2ee] px-1.5 py-0.5 rounded">
              Google Places
            </span>
          )}
          {geocodingState === 'loading' && (
            <span className="text-xs text-[#c9a96e]">Searching…</span>
          )}
          {geocodingState === 'success' && (
            <span className="text-green-500 text-sm" title="Address geocoded successfully">
              ✓
            </span>
          )}
          {geocodingState === 'error' && (
            <span className="text-red-500 text-xs" title="Address not found">
              ✗
            </span>
          )}
        </div>
      </div>
      
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#e8e4e0] rounded shadow-lg z-30 max-h-52 overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#f5f2ee] bg-[#f5f2ee]">
            <p className="text-[10px] text-[#9e998f]">Suggestions from Google Places</p>
          </div>
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(s)
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-[#f5f2ee] border-b border-[#f5f2ee] last:border-0"
            >
              <span className="text-[#1a1a1a] font-medium">{s.main_text}</span>
              {s.secondary_text && (
                <span className="text-[#9e998f] text-xs ml-2">{s.secondary_text}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// CatAreaCard
// ─────────────────────────────────────────────────────────────────

function CatAreaCard({
  area,
  onChange,
  onDelete,
}: {
  area: CatArea
  onChange: (updated: CatArea) => void
  onDelete: () => void
}) {
  return (
    <div className="border border-[#e8e4e0] rounded-lg p-4 border-l-4" style={{ borderLeftColor: '#d97706' }}>
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 mr-4">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            CAT area label
          </label>
          <input
            type="text"
            value={area.label}
            onChange={(e) => onChange({ ...area, label: e.target.value })}
            placeholder="e.g. Cyclone Zone — North WA"
            className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
          />
        </div>

        {/* Is active toggle */}
        <div className="flex flex-col items-end gap-1">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold">
            Active
          </label>
          <button
            onClick={() => onChange({ ...area, is_active: !area.is_active })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              area.is_active ? 'bg-amber-500' : 'bg-[#e8e4e0]'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                area.is_active ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </button>
          {area.is_active && (
            <span className="text-[10px] text-amber-600 font-semibold">LIVE</span>
          )}
        </div>

        <button
          onClick={onDelete}
          className="text-[#b0a89e] hover:text-red-500 text-lg leading-none mt-5 ml-2 transition-colors"
          title="Delete CAT area"
        >
          ×
        </button>
      </div>

      {/* Coverage type */}
      <div className="mb-3">
        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">
          Coverage type
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-[#3a3530] cursor-pointer">
            <input
              type="radio"
              name={`cat-type-${area.id}`}
              value="state"
              checked={area.type === 'state'}
              onChange={() => onChange({ ...area, type: 'state', region_description: '' })}
              className="accent-[#c9a96e]"
            />
            Entire state(s)
          </label>
          <label className="flex items-center gap-1.5 text-sm text-[#3a3530] cursor-pointer">
            <input
              type="radio"
              name={`cat-type-${area.id}`}
              value="region"
              checked={area.type === 'region'}
              onChange={() => onChange({ ...area, type: 'region' })}
              className="accent-[#c9a96e]"
            />
            Specific regions within state(s)
          </label>
        </div>
      </div>

      {/* Region description (if region type) */}
      {area.type === 'region' && (
        <div className="mb-3">
          <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
            Region description
          </label>
          <input
            type="text"
            value={area.region_description}
            onChange={(e) => onChange({ ...area, region_description: e.target.value })}
            placeholder="e.g. North of Tropic of Capricorn, Pilbara and Kimberley regions."
            className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e]"
          />
        </div>
      )}

      {/* State selection */}
      <div className="mb-3">
        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-2">
          States
        </label>
        <div className="flex flex-wrap gap-3">
          {AUSTRALIAN_STATES.map((state) => (
            <label key={state} className="flex items-center gap-1.5 text-sm text-[#3a3530] cursor-pointer">
              <input
                type="checkbox"
                checked={area.states.includes(state)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...area.states, state]
                    : area.states.filter((s) => s !== state)
                  onChange({ ...area, states: next })
                }}
                className="accent-[#c9a96e]"
              />
              {state}
            </label>
          ))}
        </div>
      </div>

      {/* Activation notes */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
          Activation notes
        </label>
        <textarea
          rows={2}
          value={area.notes}
          onChange={(e) => onChange({ ...area, notes: e.target.value })}
          placeholder="e.g. Activate only on declared CAT event — approval required before lodging."
          className="w-full border border-[#e8e4e0] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] resize-none"
        />
      </div>
    </div>
  )
}

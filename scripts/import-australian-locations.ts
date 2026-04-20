/**
 * Import script to fetch comprehensive Australian suburb/LGA data
 * and generate updated au-suburbs.ts and au-lgas.ts files
 * 
 * Data sources:
 * 1. Opendatasoft API: georef-australia-state-suburb (15,334 suburbs with LGA codes)
 * 2. GitHub: Australian-Postcode-Data (postcodes)
 */

const fs = require('fs')
const path = require('path')

interface SuburbRecord {
  scc_name: string
  ste_name: string
  lga_name: string
  lga_code: string
  scc_code: string
  geo_point_2d: number[]
}

interface PostcodeRecord {
  postcode: string
  place_name: string
  state_name: string
  state_code: string
  latitude: number
  longitude: number
}

interface AuSuburb {
  suburb: string
  state: string
  postcode: string
}

interface LgaPreset {
  lga: string
  state: string
  suburbs: AuSuburb[]
}

// State code mapping
const STATE_CODE_MAP: Record<string, string> = {
  'New South Wales': 'NSW',
  'Victoria': 'VIC',
  'Queensland': 'QLD',
  'Western Australia': 'WA',
  'South Australia': 'SA',
  'Tasmania': 'TAS',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
}

async function fetchSuburbsFromOpendatasoft(): Promise<SuburbRecord[]> {
  console.log('Fetching WA suburbs from Opendatasoft API...')
  const suburbs: SuburbRecord[] = []
  const rows = 100
  let start = 0
  let totalFetched = 0
  let totalRecords = 15334 // Known total from API

  while (totalFetched < totalRecords) {
    try {
      const url = `https://public.opendatasoft.com/api/records/1.0/search/?dataset=georef-australia-state-suburb&rows=${rows}&start=${start}&refine.ste_name=Western+Australia`
      const response = await fetch(url)
      
      if (!response.ok) {
        console.error(`HTTP error! status: ${response.status}`)
        break
      }
      
      const data = await response.json()
      
      // Update total records from API if available
      if (data.nhits && data.nhits < totalRecords) {
        totalRecords = data.nhits
      }
      
      // Check if records exist and is an array
      if (!data.records || !Array.isArray(data.records)) {
        console.error('Invalid response structure:', data)
        break
      }
      
      for (const record of data.records) {
        if (record.fields) {
          suburbs.push({
            scc_name: record.fields.scc_name,
            ste_name: record.fields.ste_name,
            lga_name: record.fields.lga_name || '',
            lga_code: record.fields.lga_code || '',
            scc_code: record.fields.scc_code,
            geo_point_2d: record.fields.geo_point_2d || [0, 0],
          })
        }
      }
      
      totalFetched = suburbs.length
      start += rows
      console.log(`Fetched ${totalFetched}/${totalRecords} WA suburbs...`)
      
      // If we got fewer records than requested, we might be at the end
      if (data.records.length < rows) {
        console.log('Reached end of dataset')
        break
      }
    } catch (error) {
      console.error(`Error fetching batch starting at ${start}:`, error)
      break
    }
  }

  console.log(`✓ Fetched ${suburbs.length} WA suburbs from Opendatasoft`)
  return suburbs
}

async function fetchPostcodesFromGitHub(): Promise<Map<string, PostcodeRecord[]>> {
  console.log('Fetching postcodes from GitHub...')
  const url = 'https://raw.githubusercontent.com/Elkfox/Australian-Postcode-Data/master/au_postcodes.csv'
  const response = await fetch(url)
  const csvText = await response.text()
  
  const postcodeMap = new Map<string, PostcodeRecord[]>()
  const lines = csvText.split('\n')
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    
    const parts = line.split(',')
    if (parts.length < 6) continue
    
    const record: PostcodeRecord = {
      postcode: parts[0],
      place_name: parts[1],
      state_name: parts[2],
      state_code: parts[3],
      latitude: parseFloat(parts[4]),
      longitude: parseFloat(parts[5]),
    }
    
    const key = `${record.place_name.toLowerCase()}-${record.state_code}`
    if (!postcodeMap.has(key)) {
      postcodeMap.set(key, [])
    }
    postcodeMap.get(key)!.push(record)
  }
  
  console.log(`✓ Fetched ${postcodeMap.size} unique postcode locations from GitHub`)
  return postcodeMap
}

function mergeSuburbsAndPostcodes(
  suburbs: SuburbRecord[],
  postcodeMap: Map<string, PostcodeRecord[]>
): AuSuburb[] {
  console.log('Merging suburbs with postcodes...')
  const mergedSuburbs: AuSuburb[] = []
  const seen = new Set<string>()
  
  for (const suburb of suburbs) {
    const stateCode = STATE_CODE_MAP[suburb.ste_name] || suburb.ste_name.substring(0, 3).toUpperCase()
    const key = `${suburb.scc_name.toLowerCase()}-${stateCode}`
    
    let postcode = ''
    const postcodeRecords = postcodeMap.get(key)
    
    if (postcodeRecords && postcodeRecords.length > 0) {
      // Use the first postcode found
      postcode = postcodeRecords[0].postcode
    } else {
      // Try fuzzy match
      for (const [mapKey, records] of postcodeMap.entries()) {
        if (mapKey.startsWith(suburb.scc_name.toLowerCase().substring(0, 5))) {
          postcode = records[0].postcode
          break
        }
      }
    }
    
    const uniqueKey = `${suburb.scc_name}-${stateCode}-${postcode}`
    if (!seen.has(uniqueKey) && postcode) {
      seen.add(uniqueKey)
      mergedSuburbs.push({
        suburb: suburb.scc_name,
        state: stateCode,
        postcode,
      })
    }
  }
  
  console.log(`✓ Merged ${mergedSuburbs.length} suburbs with postcodes`)
  return mergedSuburbs
}

function buildLgaPresets(suburbs: SuburbRecord[], mergedSuburbs: AuSuburb[]): LgaPreset[] {
  console.log('Building LGA presets...')
  const lgaMap = new Map<string, Set<AuSuburb>>()
  
  // Group suburbs by LGA
  for (const suburb of suburbs) {
    const stateCode = STATE_CODE_MAP[suburb.ste_name] || suburb.ste_name.substring(0, 3).toUpperCase()
    const lgas = suburb.lga_name.split(',')
    
    for (const lgaName of lgas) {
      const trimmedLga = lgaName.trim()
      const key = `${trimmedLga}-${stateCode}`
      
      if (!lgaMap.has(key)) {
        lgaMap.set(key, new Set())
      }
      
      // Find matching suburb with postcode
      const suburbWithPostcode = mergedSuburbs.find(
        s => s.suburb === suburb.scc_name && s.state === stateCode
      )
      
      if (suburbWithPostcode) {
        lgaMap.get(key)!.add(suburbWithPostcode)
      }
    }
  }
  
  // Convert to LgaPreset format
  const lgaPresets: LgaPreset[] = []
  for (const [key, suburbSet] of lgaMap.entries()) {
    const [lgaName, state] = key.split('-')
    const suburbs = Array.from(suburbSet)
    
    if (suburbs.length > 0) {
      lgaPresets.push({
        lga: lgaName,
        state,
        suburbs,
      })
    }
  }
  
  // Sort by state then LGA name
  lgaPresets.sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state)
    return a.lga.localeCompare(b.lga)
  })
  
  console.log(`✓ Built ${lgaPresets.length} LGA presets`)
  return lgaPresets
}

function generateAuSuburbsFile(suburbs: AuSuburb[]): string {
  const header = `// Australian suburb reference data for the service areas autocomplete.
//
// This is a comprehensive dataset sourced from:
// - Opendatasoft: georef-australia-state-suburb (15,334 suburbs)
// - GitHub: Australian-Postcode-Data (postcodes)
//
// Last updated: ${new Date().toISOString().split('T')[0]}

export interface AuSuburb {
  suburb: string
  state: string
  postcode: string
}

export const AU_SUBURBS: AuSuburb[] = [
`

  const body = suburbs
    .map(s => `  { suburb: '${s.suburb}', state: '${s.state}', postcode: '${s.postcode}' },`)
    .join('\n')

  const footer = `
]
`

  return header + body + footer
}

function generateAuLgasFile(lgas: LgaPreset[]): string {
  const header = `// Australian Local Government Area (LGA) presets for the service areas bulk-add feature.
//
// Each LGA entry contains the LGA name, state, and a list of suburbs within it.
// This is a comprehensive dataset sourced from Opendatasoft georef-australia-state-suburb.
//
// When a user adds an LGA, all suburbs are tagged with \`lga: lgaName\`.
// The UI groups them under the LGA header only while all suburbs remain present.
// Deleting any suburb from the group causes the LGA header to disappear
// and the remaining suburbs display as individual chips.
//
// Last updated: ${new Date().toISOString().split('T')[0]}

import type { AuSuburb } from './au-suburbs'

export interface LgaPreset {
  lga: string
  state: string
  suburbs: AuSuburb[]
}

export const AU_LGA_PRESETS: LgaPreset[] = [
`

  const body = lgas
    .map(lga => {
      const suburbsStr = lga.suburbs
        .map(s => `      { suburb: '${s.suburb}', state: '${s.state}', postcode: '${s.postcode}' }`)
        .join(',\n')
      
      return `  {
    lga: '${lga.lga}',
    state: '${lga.state}',
    suburbs: [
${suburbsStr}
    ],
  },`
    })
    .join('\n')

  const footer = `
]
`

  return header + body + footer
}

async function main() {
  console.log('Starting Australian location data import...\n')
  
  try {
    // Fetch data
    const suburbs = await fetchSuburbsFromOpendatasoft()
    const postcodeMap = await fetchPostcodesFromGitHub()
    
    // Merge data
    const mergedSuburbs = mergeSuburbsAndPostcodes(suburbs, postcodeMap)
    const lgaPresets = buildLgaPresets(suburbs, mergedSuburbs)
    
    // Sort suburbs alphabetically
    mergedSuburbs.sort((a, b) => {
      if (a.state !== b.state) return a.state.localeCompare(b.state)
      if (a.suburb !== b.suburb) return a.suburb.localeCompare(b.suburb)
      return a.postcode.localeCompare(b.postcode)
    })
    
    // Generate files
    const suburbsFile = generateAuSuburbsFile(mergedSuburbs)
    const lgasFile = generateAuLgasFile(lgaPresets)
    
    // Write files
    const suburbsPath = path.join(__dirname, '../lib/data/au-suburbs.ts')
    const lgasPath = path.join(__dirname, '../lib/data/au-lgas.ts')
    
    fs.writeFileSync(suburbsPath, suburbsFile)
    console.log(`✓ Wrote ${suburbsPath}`)
    
    fs.writeFileSync(lgasPath, lgasFile)
    console.log(`✓ Wrote ${lgasPath}`)
    
    console.log('\n✓ Import complete!')
    console.log(`  - ${mergedSuburbs.length} suburbs with postcodes`)
    console.log(`  - ${lgaPresets.length} LGA presets`)
  } catch (error) {
    console.error('Error during import:', error)
    process.exit(1)
  }
}

main()

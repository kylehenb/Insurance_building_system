// Australian Local Government Area (LGA) presets for the service areas bulk-add feature.
//
// Each LGA entry contains the LGA name, state, and a list of suburbs within it.
// This is a curated subset covering Perth metro and key WA regional centres.
// Groupings are approximate — boundaries occasionally differ from official ABS definitions.
//
// When a user adds an LGA, all suburbs are tagged with `lga: lgaName`.
// The UI groups them under the LGA header only while all suburbs remain present.
// Deleting any suburb from the group causes the LGA header to disappear
// and the remaining suburbs display as individual chips.

import type { AuSuburb } from './au-suburbs'

export interface LgaPreset {
  lga: string
  state: string
  suburbs: AuSuburb[]
}

export const AU_LGA_PRESETS: LgaPreset[] = [
  // ── Perth Metro — North ────────────────────────────────────────────────────
  {
    lga: 'City of Joondalup',
    state: 'WA',
    suburbs: [
      { suburb: 'Joondalup', state: 'WA', postcode: '6027' },
      { suburb: 'Edgewater', state: 'WA', postcode: '6027' },
      { suburb: 'Mullaloo', state: 'WA', postcode: '6027' },
      { suburb: 'Ocean Reef', state: 'WA', postcode: '6027' },
      { suburb: 'Connolly', state: 'WA', postcode: '6027' },
      { suburb: 'Heathridge', state: 'WA', postcode: '6027' },
      { suburb: 'Beldon', state: 'WA', postcode: '6027' },
      { suburb: 'Currambine', state: 'WA', postcode: '6028' },
      { suburb: 'Kinross', state: 'WA', postcode: '6028' },
      { suburb: 'Duncraig', state: 'WA', postcode: '6023' },
    ],
  },
  {
    lga: 'City of Stirling',
    state: 'WA',
    suburbs: [
      { suburb: 'Stirling', state: 'WA', postcode: '6021' },
      { suburb: 'Innaloo', state: 'WA', postcode: '6018' },
      { suburb: 'Karrinyup', state: 'WA', postcode: '6018' },
      { suburb: 'Gwelup', state: 'WA', postcode: '6018' },
      { suburb: 'Osborne Park', state: 'WA', postcode: '6017' },
      { suburb: 'Scarborough', state: 'WA', postcode: '6019' },
      { suburb: 'Hamersley', state: 'WA', postcode: '6022' },
      { suburb: 'Balga', state: 'WA', postcode: '6061' },
      { suburb: 'Nollamara', state: 'WA', postcode: '6061' },
      { suburb: 'Westminster', state: 'WA', postcode: '6061' },
      { suburb: 'Yokine', state: 'WA', postcode: '6060' },
      { suburb: 'Joondanna', state: 'WA', postcode: '6060' },
      { suburb: 'Dianella', state: 'WA', postcode: '6059' },
      { suburb: 'Noranda', state: 'WA', postcode: '6062' },
      { suburb: 'Morley', state: 'WA', postcode: '6062' },
    ],
  },
  {
    lga: 'City of Wanneroo',
    state: 'WA',
    suburbs: [
      { suburb: 'Wanneroo', state: 'WA', postcode: '6065' },
      { suburb: 'Madeley', state: 'WA', postcode: '6065' },
      { suburb: 'Ballajura', state: 'WA', postcode: '6066' },
      { suburb: 'Ellenbrook', state: 'WA', postcode: '6069' },
      { suburb: 'The Vines', state: 'WA', postcode: '6069' },
      { suburb: 'Two Rocks', state: 'WA', postcode: '6037' },
      { suburb: 'Yanchep', state: 'WA', postcode: '6035' },
      { suburb: 'Butler', state: 'WA', postcode: '6036' },
      { suburb: 'Clarkson', state: 'WA', postcode: '6030' },
      { suburb: 'Merriwa', state: 'WA', postcode: '6030' },
      { suburb: 'Quinns Rocks', state: 'WA', postcode: '6030' },
      { suburb: 'Mindarie', state: 'WA', postcode: '6030' },
      { suburb: 'Greenwood', state: 'WA', postcode: '6024' },
      { suburb: 'Warwick', state: 'WA', postcode: '6024' },
      { suburb: 'Craigie', state: 'WA', postcode: '6025' },
      { suburb: 'Kingsley', state: 'WA', postcode: '6026' },
    ],
  },
  // ── Perth Metro — CBD & Inner ──────────────────────────────────────────────
  {
    lga: 'City of Perth',
    state: 'WA',
    suburbs: [
      { suburb: 'Perth', state: 'WA', postcode: '6000' },
      { suburb: 'East Perth', state: 'WA', postcode: '6004' },
      { suburb: 'West Perth', state: 'WA', postcode: '6005' },
      { suburb: 'North Perth', state: 'WA', postcode: '6006' },
      { suburb: 'Northbridge', state: 'WA', postcode: '6003' },
      { suburb: 'Leederville', state: 'WA', postcode: '6007' },
    ],
  },
  {
    lga: 'City of Subiaco',
    state: 'WA',
    suburbs: [
      { suburb: 'Subiaco', state: 'WA', postcode: '6008' },
      { suburb: 'Shenton Park', state: 'WA', postcode: '6008' },
      { suburb: 'Wembley', state: 'WA', postcode: '6014' },
      { suburb: 'Floreat', state: 'WA', postcode: '6014' },
      { suburb: 'City Beach', state: 'WA', postcode: '6015' },
    ],
  },
  {
    lga: 'City of Nedlands',
    state: 'WA',
    suburbs: [
      { suburb: 'Nedlands', state: 'WA', postcode: '6009' },
      { suburb: 'Crawley', state: 'WA', postcode: '6009' },
    ],
  },
  {
    lga: 'Town of Claremont',
    state: 'WA',
    suburbs: [
      { suburb: 'Claremont', state: 'WA', postcode: '6010' },
    ],
  },
  {
    lga: 'Town of Cottesloe',
    state: 'WA',
    suburbs: [
      { suburb: 'Cottesloe', state: 'WA', postcode: '6011' },
      { suburb: 'Mosman Park', state: 'WA', postcode: '6012' },
    ],
  },
  {
    lga: 'Town of Cambridge',
    state: 'WA',
    suburbs: [
      { suburb: 'Wembley', state: 'WA', postcode: '6014' },
      { suburb: 'Floreat', state: 'WA', postcode: '6014' },
      { suburb: 'City Beach', state: 'WA', postcode: '6015' },
      { suburb: 'Mount Hawthorn', state: 'WA', postcode: '6016' },
    ],
  },
  // ── Perth Metro — East ────────────────────────────────────────────────────
  {
    lga: 'City of Swan',
    state: 'WA',
    suburbs: [
      { suburb: 'Midland', state: 'WA', postcode: '6056' },
      { suburb: 'Swan View', state: 'WA', postcode: '6056' },
      { suburb: 'Midvale', state: 'WA', postcode: '6056' },
      { suburb: 'Jane Brook', state: 'WA', postcode: '6056' },
      { suburb: 'Guildford', state: 'WA', postcode: '6055' },
      { suburb: 'Bassendean', state: 'WA', postcode: '6054' },
    ],
  },
  {
    lga: 'City of Kalamunda',
    state: 'WA',
    suburbs: [
      { suburb: 'Kalamunda', state: 'WA', postcode: '6076' },
      { suburb: 'Forrestfield', state: 'WA', postcode: '6058' },
      { suburb: 'High Wycombe', state: 'WA', postcode: '6057' },
    ],
  },
  {
    lga: 'City of Bayswater',
    state: 'WA',
    suburbs: [
      { suburb: 'Bayswater', state: 'WA', postcode: '6053' },
      { suburb: 'Maylands', state: 'WA', postcode: '6051' },
      { suburb: 'Mount Lawley', state: 'WA', postcode: '6050' },
      { suburb: 'Inglewood', state: 'WA', postcode: '6052' },
      { suburb: 'Bedford', state: 'WA', postcode: '6052' },
      { suburb: 'Coolbinia', state: 'WA', postcode: '6050' },
      { suburb: 'Beechboro', state: 'WA', postcode: '6063' },
    ],
  },
  {
    lga: 'City of Belmont',
    state: 'WA',
    suburbs: [
      { suburb: 'Belmont', state: 'WA', postcode: '6104' },
      { suburb: 'Rivervale', state: 'WA', postcode: '6103' },
      { suburb: 'Carlisle', state: 'WA', postcode: '6101' },
      { suburb: 'Cloverdale', state: 'WA', postcode: '6105' },
      { suburb: 'Lathlain', state: 'WA', postcode: '6100' },
    ],
  },
  {
    lga: 'City of Victoria Park',
    state: 'WA',
    suburbs: [
      { suburb: 'Victoria Park', state: 'WA', postcode: '6100' },
      { suburb: 'Bentley', state: 'WA', postcode: '6102' },
    ],
  },
  {
    lga: 'City of Canning',
    state: 'WA',
    suburbs: [
      { suburb: 'Cannington', state: 'WA', postcode: '6107' },
      { suburb: 'Wilson', state: 'WA', postcode: '6107' },
      { suburb: 'Kenwick', state: 'WA', postcode: '6107' },
      { suburb: 'Beckenham', state: 'WA', postcode: '6107' },
      { suburb: 'Welshpool', state: 'WA', postcode: '6106' },
      { suburb: 'Wattle Grove', state: 'WA', postcode: '6107' },
    ],
  },
  {
    lga: 'City of Gosnells',
    state: 'WA',
    suburbs: [
      { suburb: 'Gosnells', state: 'WA', postcode: '6110' },
      { suburb: 'Maddington', state: 'WA', postcode: '6109' },
      { suburb: 'Thornlie', state: 'WA', postcode: '6108' },
      { suburb: 'Huntingdale', state: 'WA', postcode: '6110' },
    ],
  },
  {
    lga: 'City of Armadale',
    state: 'WA',
    suburbs: [
      { suburb: 'Armadale', state: 'WA', postcode: '6112' },
      { suburb: 'Harrisdale', state: 'WA', postcode: '6112' },
      { suburb: 'Piara Waters', state: 'WA', postcode: '6112' },
    ],
  },
  // ── Perth Metro — South & Fremantle ───────────────────────────────────────
  {
    lga: 'City of Fremantle',
    state: 'WA',
    suburbs: [
      { suburb: 'Fremantle', state: 'WA', postcode: '6160' },
      { suburb: 'South Fremantle', state: 'WA', postcode: '6162' },
      { suburb: 'East Fremantle', state: 'WA', postcode: '6158' },
      { suburb: 'North Coogee', state: 'WA', postcode: '6163' },
    ],
  },
  {
    lga: 'City of Melville',
    state: 'WA',
    suburbs: [
      { suburb: 'Melville', state: 'WA', postcode: '6156' },
      { suburb: 'Applecross', state: 'WA', postcode: '6153' },
      { suburb: 'Mount Pleasant', state: 'WA', postcode: '6153' },
      { suburb: 'Murdoch', state: 'WA', postcode: '6150' },
      { suburb: 'Winthrop', state: 'WA', postcode: '6150' },
      { suburb: 'Bateman', state: 'WA', postcode: '6150' },
      { suburb: 'Bull Creek', state: 'WA', postcode: '6149' },
      { suburb: 'Leeming', state: 'WA', postcode: '6149' },
      { suburb: 'Willetton', state: 'WA', postcode: '6155' },
      { suburb: 'Booragoon', state: 'WA', postcode: '6154' },
      { suburb: 'Rossmoyne', state: 'WA', postcode: '6148' },
      { suburb: 'Riverton', state: 'WA', postcode: '6148' },
      { suburb: 'Shelley', state: 'WA', postcode: '6148' },
      { suburb: 'Parkwood', state: 'WA', postcode: '6147' },
      { suburb: 'Ferndale', state: 'WA', postcode: '6148' },
      { suburb: 'Palmyra', state: 'WA', postcode: '6157' },
    ],
  },
  {
    lga: 'Town of South Perth',
    state: 'WA',
    suburbs: [
      { suburb: 'South Perth', state: 'WA', postcode: '6151' },
      { suburb: 'Como', state: 'WA', postcode: '6152' },
      { suburb: 'Manning', state: 'WA', postcode: '6152' },
    ],
  },
  {
    lga: 'City of Cockburn',
    state: 'WA',
    suburbs: [
      { suburb: 'Coogee', state: 'WA', postcode: '6166' },
      { suburb: 'Hamilton Hill', state: 'WA', postcode: '6163' },
      { suburb: 'Spearwood', state: 'WA', postcode: '6163' },
      { suburb: 'Kardinya', state: 'WA', postcode: '6163' },
      { suburb: 'Jandakot', state: 'WA', postcode: '6164' },
      { suburb: 'Atwell', state: 'WA', postcode: '6164' },
      { suburb: 'Yangebup', state: 'WA', postcode: '6164' },
      { suburb: 'Beeliar', state: 'WA', postcode: '6164' },
      { suburb: 'Success', state: 'WA', postcode: '6164' },
      { suburb: 'Cockburn Central', state: 'WA', postcode: '6164' },
    ],
  },
  {
    lga: 'City of Kwinana',
    state: 'WA',
    suburbs: [
      { suburb: 'Kwinana', state: 'WA', postcode: '6167' },
      { suburb: 'Bertram', state: 'WA', postcode: '6167' },
      { suburb: 'Hope Valley', state: 'WA', postcode: '6165' },
    ],
  },
  {
    lga: 'City of Rockingham',
    state: 'WA',
    suburbs: [
      { suburb: 'Rockingham', state: 'WA', postcode: '6168' },
      { suburb: 'Safety Bay', state: 'WA', postcode: '6169' },
      { suburb: 'Warnbro', state: 'WA', postcode: '6169' },
      { suburb: 'Port Kennedy', state: 'WA', postcode: '6172' },
      { suburb: 'Baldivis', state: 'WA', postcode: '6171' },
      { suburb: 'Secret Harbour', state: 'WA', postcode: '6173' },
      { suburb: 'Golden Bay', state: 'WA', postcode: '6174' },
    ],
  },
  // ── Mandurah / Peel ───────────────────────────────────────────────────────
  {
    lga: 'City of Mandurah',
    state: 'WA',
    suburbs: [
      { suburb: 'Mandurah', state: 'WA', postcode: '6210' },
      { suburb: 'Halls Head', state: 'WA', postcode: '6210' },
      { suburb: 'Falcon', state: 'WA', postcode: '6210' },
      { suburb: 'Meadow Springs', state: 'WA', postcode: '6210' },
      { suburb: 'Dawesville', state: 'WA', postcode: '6211' },
    ],
  },
  {
    lga: 'Shire of Murray',
    state: 'WA',
    suburbs: [
      { suburb: 'Pinjarra', state: 'WA', postcode: '6208' },
    ],
  },
  // ── South West WA ─────────────────────────────────────────────────────────
  {
    lga: 'City of Bunbury',
    state: 'WA',
    suburbs: [
      { suburb: 'Bunbury', state: 'WA', postcode: '6230' },
      { suburb: 'Australind', state: 'WA', postcode: '6233' },
      { suburb: 'Eaton', state: 'WA', postcode: '6232' },
    ],
  },
  {
    lga: 'City of Busselton',
    state: 'WA',
    suburbs: [
      { suburb: 'Busselton', state: 'WA', postcode: '6280' },
      { suburb: 'Dunsborough', state: 'WA', postcode: '6281' },
      { suburb: 'Yallingup', state: 'WA', postcode: '6282' },
    ],
  },
  {
    lga: 'Shire of Augusta-Margaret River',
    state: 'WA',
    suburbs: [
      { suburb: 'Margaret River', state: 'WA', postcode: '6285' },
      { suburb: 'Augusta', state: 'WA', postcode: '6290' },
    ],
  },
  {
    lga: 'Shire of Manjimup',
    state: 'WA',
    suburbs: [
      { suburb: 'Manjimup', state: 'WA', postcode: '6258' },
      { suburb: 'Pemberton', state: 'WA', postcode: '6260' },
    ],
  },
  {
    lga: 'Shire of Bridgetown-Greenbushes',
    state: 'WA',
    suburbs: [
      { suburb: 'Bridgetown', state: 'WA', postcode: '6255' },
    ],
  },
  {
    lga: 'Shire of Harvey',
    state: 'WA',
    suburbs: [
      { suburb: 'Harvey', state: 'WA', postcode: '6220' },
    ],
  },
  // ── Great Southern ────────────────────────────────────────────────────────
  {
    lga: 'City of Albany',
    state: 'WA',
    suburbs: [
      { suburb: 'Albany', state: 'WA', postcode: '6330' },
      { suburb: 'Denmark', state: 'WA', postcode: '6333' },
    ],
  },
  {
    lga: 'Shire of Katanning',
    state: 'WA',
    suburbs: [
      { suburb: 'Katanning', state: 'WA', postcode: '6317' },
    ],
  },
  // ── Mid West ──────────────────────────────────────────────────────────────
  {
    lga: 'City of Greater Geraldton',
    state: 'WA',
    suburbs: [
      { suburb: 'Geraldton', state: 'WA', postcode: '6530' },
      { suburb: 'Dongara', state: 'WA', postcode: '6525' },
    ],
  },
  // ── Goldfields ────────────────────────────────────────────────────────────
  {
    lga: 'City of Kalgoorlie-Boulder',
    state: 'WA',
    suburbs: [
      { suburb: 'Kalgoorlie', state: 'WA', postcode: '6430' },
      { suburb: 'Boulder', state: 'WA', postcode: '6432' },
      { suburb: 'Coolgardie', state: 'WA', postcode: '6429' },
    ],
  },
  {
    lga: 'Shire of Esperance',
    state: 'WA',
    suburbs: [
      { suburb: 'Esperance', state: 'WA', postcode: '6450' },
    ],
  },
  // ── Pilbara ───────────────────────────────────────────────────────────────
  {
    lga: 'City of Karratha',
    state: 'WA',
    suburbs: [
      { suburb: 'Karratha', state: 'WA', postcode: '6714' },
      { suburb: 'Dampier', state: 'WA', postcode: '6713' },
      { suburb: 'Roebourne', state: 'WA', postcode: '6718' },
    ],
  },
  {
    lga: 'Town of Port Hedland',
    state: 'WA',
    suburbs: [
      { suburb: 'Port Hedland', state: 'WA', postcode: '6721' },
      { suburb: 'South Hedland', state: 'WA', postcode: '6722' },
    ],
  },
  {
    lga: 'Shire of East Pilbara',
    state: 'WA',
    suburbs: [
      { suburb: 'Newman', state: 'WA', postcode: '6753' },
      { suburb: 'Tom Price', state: 'WA', postcode: '6751' },
      { suburb: 'Paraburdoo', state: 'WA', postcode: '6754' },
    ],
  },
  // ── Kimberley ─────────────────────────────────────────────────────────────
  {
    lga: 'Shire of Broome',
    state: 'WA',
    suburbs: [
      { suburb: 'Broome', state: 'WA', postcode: '6725' },
    ],
  },
  {
    lga: 'Shire of Wyndham-East Kimberley',
    state: 'WA',
    suburbs: [
      { suburb: 'Kununurra', state: 'WA', postcode: '6743' },
      { suburb: 'Wyndham', state: 'WA', postcode: '6740' },
    ],
  },
]

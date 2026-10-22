import { readFile } from 'node:fs/promises'
import path from 'node:path'

// The Vercel Chromium (@sparticuz/chromium) ships only Open Sans, so documents
// designed in Arial render with different spacing. Liberation Sans has the same
// metrics as Arial (SIL OFL 1.1 — see fonts/LICENSE-LiberationSans.txt) and is
// embedded as @font-face under the family name "Arial", so templates keep
// using `font-family: Arial`.

const FONT_DIR = path.join(process.cwd(), 'lib', 'pdf', 'fonts')

let fontCssPromise: Promise<string | null> | null = null

export function loadArialMetricFontCss(): Promise<string | null> {
  fontCssPromise ??= Promise.all([
    readFile(path.join(FONT_DIR, 'LiberationSans-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'LiberationSans-Bold.ttf')),
  ])
    .then(([regular, bold]) => [
      `@font-face { font-family: 'Arial'; font-weight: 400; src: url(data:font/ttf;base64,${regular.toString('base64')}) format('truetype'); }`,
      `@font-face { font-family: 'Arial'; font-weight: 700; src: url(data:font/ttf;base64,${bold.toString('base64')}) format('truetype'); }`,
    ].join('\n'))
    .catch(err => {
      console.error('PDF fonts not found, falling back to system fonts', err)
      return null
    })
  return fontCssPromise
}

// Fonts for the print-page documents (quote, report, TCC, photos; see
// lib/pdf/render-print-document.tsx). The print pages get DM Sans, DM Mono and
// Geist Mono from next/font (same files and @font-face rules here, see
// fonts/LICENSE-DM-Geist.txt), and anything without an explicit font falls
// back to the browser default, Times New Roman — Liberation Serif has its
// metrics. Arial (Allianz/Sedgwick template) is Liberation Sans, as above.

const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT_RANGE = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF'

interface FaceSpec {
  family: string
  file: string
  weight: string
  style?: 'normal' | 'italic'
  unicodeRange?: string
}

const PRINT_PAGE_FACES: FaceSpec[] = [
  // next/font declares DM Sans at 400 and 500 only (app/layout.tsx); heavier
  // text is synthesised from 500 in the browser, and so it is here.
  ...['400', '500'].flatMap(weight => [
    { family: 'DM Sans', file: 'DMSans-latin-ext.woff2', weight, unicodeRange: LATIN_EXT_RANGE },
    { family: 'DM Sans', file: 'DMSans-latin.woff2', weight, unicodeRange: LATIN_RANGE },
  ]),
  { family: 'DM Mono', file: 'DMMono-latin-ext.woff2', weight: '400', unicodeRange: LATIN_EXT_RANGE },
  { family: 'DM Mono', file: 'DMMono-latin.woff2', weight: '400', unicodeRange: LATIN_RANGE },
  { family: 'Geist Mono', file: 'GeistMono-latin-ext.woff2', weight: '100 900', unicodeRange: LATIN_EXT_RANGE },
  { family: 'Geist Mono', file: 'GeistMono-latin.woff2', weight: '100 900', unicodeRange: LATIN_RANGE },
  { family: 'Times New Roman', file: 'LiberationSerif-Regular.ttf', weight: '400' },
  { family: 'Times New Roman', file: 'LiberationSerif-Bold.ttf', weight: '700' },
  { family: 'Times New Roman', file: 'LiberationSerif-Italic.ttf', weight: '400', style: 'italic' },
  { family: 'Times New Roman', file: 'LiberationSerif-BoldItalic.ttf', weight: '700', style: 'italic' },
  { family: 'Arial', file: 'LiberationSans-Regular.ttf', weight: '400' },
  { family: 'Arial', file: 'LiberationSans-Bold.ttf', weight: '700' },
  { family: 'Arial', file: 'LiberationSans-Italic.ttf', weight: '400', style: 'italic' },
  { family: 'Arial', file: 'LiberationSans-BoldItalic.ttf', weight: '700', style: 'italic' },
]

// The CSS variables next/font sets on <html> (app/layout.tsx), which the
// documents use in inline styles.
const FONT_VARIABLES = `:root {
  --font-dm-sans: 'DM Sans', 'DM Sans Fallback';
  --font-dm-mono: 'DM Mono', 'DM Mono Fallback';
  --font-geist-mono: 'Geist Mono', 'Geist Mono Fallback';
}`

let printPageFontCssPromise: Promise<string> | null = null

/** @font-face rules (data: URIs) and font variables for the print-page documents. */
export function loadPrintPageFontCss(): Promise<string> {
  printPageFontCssPromise ??= Promise.all(PRINT_PAGE_FACES.map(async face => {
    const buf = await readFile(path.join(FONT_DIR, face.file))
    const format = face.file.endsWith('.woff2') ? 'woff2' : 'truetype'
    const mime = format === 'woff2' ? 'font/woff2' : 'font/ttf'
    return `@font-face { font-family: '${face.family}'; font-style: ${face.style ?? 'normal'}; font-weight: ${face.weight}; `
      + `src: url(data:${mime};base64,${buf.toString('base64')}) format('${format}');`
      + `${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ''} }`
  }))
    .then(faces => [...faces, FONT_VARIABLES].join('\n'))
    .catch(err => {
      printPageFontCssPromise = null
      throw err
    })
  return printPageFontCssPromise
}

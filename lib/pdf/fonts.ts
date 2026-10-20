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

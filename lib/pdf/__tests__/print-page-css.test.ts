import { describe, it, expect } from 'vitest'
import { buildPrintCss } from '../../../scripts/build-print-css.mjs'
import { PRINT_PAGE_CLASSES, PRINT_PAGE_CSS } from '../print-page-css.generated'

describe('print page CSS', () => {
  it('is up to date with components/documents and app/globals.css (run node scripts/build-print-css.mjs)', async () => {
    const { css, candidates } = await buildPrintCss()
    expect(PRINT_PAGE_CLASSES).toEqual(candidates)
    expect(PRINT_PAGE_CSS).toBe(css)
  }, 30_000)

  it('carries the app base styles the print pages rely on', () => {
    expect(PRINT_PAGE_CSS).toContain('@page{margin:1cm}')
    expect(PRINT_PAGE_CSS).toContain('.max-w-4xl{')
    expect(PRINT_PAGE_CSS).toContain('line-height:1.5')
  })
})

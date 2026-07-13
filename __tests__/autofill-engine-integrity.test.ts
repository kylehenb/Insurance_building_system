/**
 * Regression test for backslash corruption in autofill script generation.
 *
 * Root cause: the full JS template (data + engine) was sent to Claude, and
 * Claude would drop backslashes from regex escape sequences when reproducing
 * the engine code (e.g. /\s+/g → /s+/g). Fix: the engine is now a server-side
 * constant never passed to the LLM. This test verifies the engine constants
 * contain correct backslash sequences and are structurally separate from the
 * data templates that Claude receives.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const src = readFileSync(
  join(process.cwd(), 'app/api/midcity/generate-insurance-report/route.ts'),
  'utf-8'
)

// Pairs of [dataTemplateName, engineName] for each insurer template
const TEMPLATES = [
  ['AAI_JS_DATA_TEMPLATE',          'AAI_JS_ENGINE'],
  ['IAG_JS_DATA_TEMPLATE',          'IAG_JS_ENGINE'],
  ['AUTO_GENERAL_JS_DATA_TEMPLATE', 'AUTO_GENERAL_JS_ENGINE'],
] as const

describe('autofill script engine: backslash escape sequences survive the pipeline', () => {

  for (const [dataName, engineName] of TEMPLATES) {
    describe(engineName, () => {

      it('engine constant is defined and comes after its data template', () => {
        const dataIdx   = src.indexOf(`const ${dataName}`)
        const engineIdx = src.indexOf(`const ${engineName}`)
        expect(dataIdx,   `${dataName} not found in route.ts`).toBeGreaterThan(-1)
        expect(engineIdx, `${engineName} not found in route.ts`).toBeGreaterThan(-1)
        expect(engineIdx).toBeGreaterThan(dataIdx)
      })

      it('data template does not contain engine functions (engine not sent to Claude)', () => {
        const dataIdx   = src.indexOf(`const ${dataName}`)
        const engineIdx = src.indexOf(`const ${engineName}`)
        const dataSection = src.slice(dataIdx, engineIdx)
        // These functions live in the engine and must not appear in the data template
        expect(dataSection).not.toContain('function runFormFill')
        expect(dataSection).not.toContain('function normLabel')
        expect(dataSection).not.toContain('function setVal')
      })

      it('Claude prompt uses the data template, not the full template', () => {
        // The user content sent to Claude must reference the data template variable
        expect(src).toContain(`\${${dataName}}`)
        // The old unsplit variable name must not appear in the source
        const oldName = dataName.replace('_DATA_TEMPLATE', '_TEMPLATE')
        expect(src).not.toContain(`\${${oldName}}`)
      })

    })
  }

  describe('AUTO_GENERAL_JS_ENGINE (the template that had the confirmed bug)', () => {

    it('contains /\\s+/g intact — the exact sequence that was being corrupted', () => {
      const idx = src.indexOf('const AUTO_GENERAL_JS_ENGINE')
      expect(idx).toBeGreaterThan(-1)
      const engineSlice = src.slice(idx, idx + 8000)
      // /\s+/g — backslash must be present
      expect(engineSlice).toContain('/\\s+/g')
      // The corrupted form must not appear
      expect(engineSlice).not.toMatch(/replace\(\/s\+\/g/)
    })

    it('contains other backslash escape sequences intact', () => {
      const idx = src.indexOf('const AUTO_GENERAL_JS_ENGINE')
      const engineSlice = src.slice(idx, idx + 8000)
      // \s+ inside the regex — backslash-s-plus must be present as three characters
      expect(engineSlice).toContain('\\s+')
      // normLabel is the function that uses the regex; verify it is intact
      expect(engineSlice).toContain('function normLabel')
      expect(engineSlice).toContain('.trim()')
    })

    it('server response appends the engine constant to Claude output', () => {
      // The return statement for A&G must concatenate the engine, not return Claude text alone
      expect(src).toContain("javascript: jsContent.text.trimEnd() + '\\n\\n' + AUTO_GENERAL_JS_ENGINE")
    })

  })

  describe('round-trip simulation', () => {
    it('concatenating a mock filled data section with the engine produces a script with correct regex', () => {
      const idx = src.indexOf('const AUTO_GENERAL_JS_ENGINE = `')
      expect(idx).toBeGreaterThan(-1)
      // Extract the engine value: everything after the opening backtick until the closing })();`
      const afterOpen = src.slice(idx + 'const AUTO_GENERAL_JS_ENGINE = `'.length)
      const closeMarker = '})();`'
      const closeIdx = afterOpen.indexOf(closeMarker)
      expect(closeIdx).toBeGreaterThan(-1)
      const engineValue = afterOpen.slice(0, closeIdx + '})();'.length)

      // Simulate what the route does: Claude returns a filled data section, route appends engine
      const mockClaudeOutput = [
        '// A&G BUILDER SITE REPORT — AUTO-FILL SCRIPT',
        '(function() {',
        'var data = {',
        '  attendanceDate: "2024-07-08",',
        '  wallConstruction: "Brick Veneer",',
        '};',
      ].join('\n')

      const finalScript = mockClaudeOutput.trimEnd() + '\n\n' + engineValue

      // The final script must contain the correct regex — not the corrupted form
      expect(finalScript).toContain('/\\s+/g')
      expect(finalScript).not.toMatch(/replace\(\/s\+\/g/)
      // And it must be a valid complete IIFE
      expect(finalScript).toContain('(function() {')
      expect(finalScript).toContain('})();')
    })
  })

})

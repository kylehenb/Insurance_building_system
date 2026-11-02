import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Every AI request is recorded (tech spec §25): a file that calls an AI
// provider has to go through trackAi, or its spend and failures go missing
// from the health check.

const CALL = /\.(messages\.create|generateContent|embeddings\.create|chat\.completions\.create|responses\.create)\(/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) return []
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

describe('AI calls', () => {
  it('all go through trackAi', () => {
    const missing: string[] = []
    // lib/health is the recorder itself
    for (const f of [...files('lib'), ...files('app')].filter(f => !f.startsWith(join('lib', 'health')))) {
      const src = readFileSync(f, 'utf8')
      const calls = src.split('\n').filter(l => CALL.test(l)).length
      if (!calls) continue
      const tracked = src.split('\n').filter(l => CALL.test(l) && l.includes('trackAi(')).length
      if (tracked < calls) missing.push(`${f} (${calls - tracked} untracked)`)
    }
    expect(missing).toEqual([])
  })
})

import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Resolve the same "@/..." import alias as tsconfig.json, so modules under
// test can be imported the way the app imports them.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
})

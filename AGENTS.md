<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Claude voice connector (`app/api/mcp`, `lib/mcp`)

The app is exposed to Claude (iOS voice etc.) as an MCP connector. Details and the tool list: tech spec §10b "Voice Connector".

- Tools only call shared `lib/` functions — the same ones the app's buttons use. Never reimplement app logic in a tool.
- When you change a function, status value, template behaviour or table that a tool depends on, update that tool, its description and its tests in the same change.
- When you add or change a user-facing action (a new send, a status change, a new document type), ask the user whether it should also become a connector tool.
- When you add a tool, register it in `lib/mcp/tools/index.ts`, add tests in `lib/mcp/__tests__/`, and add it to the tools table in §10b.

import { NextRequest, NextResponse } from 'next/server'
import { mcpContextFor } from '@/lib/mcp/auth'
import { handleMcpMessage } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'

// Claude voice connector (MCP over Streamable HTTP, stateless). Added in
// claude.ai → Settings → Connectors as https://<app>/api/mcp with "No sign-in"
// and the header Authorization: Bearer <MCP_CONNECTOR_SECRET>.
// POST carries one JSON-RPC message; there is no server-to-client stream, so
// GET and DELETE are 405 as the spec allows. A missing or wrong key is 401.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Document sends can render several PDFs — same limit as /api/documents/send
export const maxDuration = 120

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })

export async function POST(req: NextRequest) {
  const ctx = await mcpContextFor(req.headers.get('authorization'))
  if (!ctx) return unauthorized()

  let msg: unknown
  try {
    msg = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400, headers: HEADERS },
    )
  }

  const response = await handleMcpMessage(msg, MCP_TOOLS, ctx)
  if (!response) return new NextResponse(null, { status: 202, headers: HEADERS })
  return NextResponse.json(response, { headers: HEADERS })
}

async function methodNotAllowed(req: NextRequest) {
  if (!(await mcpContextFor(req.headers.get('authorization')))) return unauthorized()
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: 'POST' } })
}

export { methodNotAllowed as GET, methodNotAllowed as DELETE }

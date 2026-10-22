import { NextRequest, NextResponse } from 'next/server'
import { mcpContextFor } from '@/lib/mcp/auth'
import { handleMcpMessage } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'

// Claude voice connector (MCP over Streamable HTTP, stateless). Added in
// claude.ai → Settings → Connectors as https://<app>/api/mcp/<MCP_CONNECTOR_SECRET>.
// POST carries one JSON-RPC message; there is no server-to-client stream, so
// GET and DELETE are 405 as the spec allows. A wrong secret is a plain 404.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: HEADERS })

export async function POST(req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  const ctx = await mcpContextFor(secret)
  if (!ctx) return notFound()

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

async function methodNotAllowed(_req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  if (!(await mcpContextFor(secret))) return notFound()
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: 'POST' } })
}

export { methodNotAllowed as GET, methodNotAllowed as DELETE }

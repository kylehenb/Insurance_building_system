import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { loadUserPermissions } from '@/lib/permissions/resolve'
import { VoiceKeyError, createVoiceKey, listVoiceKeys, revokeVoiceKey } from '@/lib/voice-keys/keys'

// Settings → Voice connector: personal keys for the Claude voice connector.
// GET    → your keys, plus everyone's when you may manage users
// POST   { label } → makes a key for you; the key is in this response only
// DELETE ?id=…  → revokes one of your keys (or anyone's, if you manage users)
export const dynamic = 'force-dynamic'

async function session() {
  const user = await getUser()
  const userId = user?.session?.user.id
  if (!user?.tenant_id || !userId) return null
  const { levels } = await loadUserPermissions(user.tenant_id, userId)
  return { tenantId: user.tenant_id, userId, canManage: levels['users.manage'] === 'allowed' }
}

const failed = (err: unknown, what: string) => {
  if (err instanceof VoiceKeyError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[voice-keys] ${what} failed:`, err)
  return NextResponse.json({ error: `Could not ${what}` }, { status: 500 })
}

export async function GET() {
  const me = await session()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const keys = await listVoiceKeys(me.tenantId, me.canManage ? undefined : me.userId)
    return NextResponse.json({
      mine: keys.filter(k => k.userId === me.userId),
      others: keys.filter(k => k.userId !== me.userId),
      canManage: me.canManage,
    })
  } catch (err) {
    return failed(err, 'load keys')
  }
}

export async function POST(req: NextRequest) {
  const me = await session()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { label?: unknown }
  try {
    const made = await createVoiceKey({ tenantId: me.tenantId, userId: me.userId, createdBy: me.userId, label: typeof body.label === 'string' ? body.label : '' })
    return NextResponse.json(made)
  } catch (err) {
    return failed(err, 'make the key')
  }
}

export async function DELETE(req: NextRequest) {
  const me = await session()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    await revokeVoiceKey({ tenantId: me.tenantId, id, by: me.userId, canManage: me.canManage })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failed(err, 'revoke the key')
  }
}

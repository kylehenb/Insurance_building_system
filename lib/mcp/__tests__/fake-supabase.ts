// A small in-memory stand-in for the Supabase query builder, enough for the
// quote / invoice / work order / report tools and the lib functions they
// call: filters, ordering, counts, paging, insert / update / delete with
// .select(), and database functions (rpc).

export type Row = Record<string, unknown>

const likeToRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/\\(.)|(%)|([^\\%])/g, (_m, esc, wild, ch) =>
    esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : wild ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}$`, 'is')

let nextId = 1

export function fakeSupabase(db: Record<string, Row[]>) {
  function from(table: string) {
    const preds: ((r: Row) => boolean)[] = []
    let mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let conflict: string[] = []
    let payload: Row | Row[] | null = null
    let head = false
    let limit = Infinity
    let offset = 0
    let sort: { col: string; dir: number } | null = null

    const rows = () => (db[table] ??= [])
    const matching = () => rows().filter(r => preds.every(p => p(r)))
    const execute = () => {
      if (mode === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload!]).map(r => ({ id: `${table}-${nextId++}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, nextId)).toISOString(), ...r }))
        rows().push(...list)
        return { data: list, count: list.length }
      }
      if (mode === 'upsert') {
        const list = Array.isArray(payload) ? payload : [payload!]
        for (const r of list) {
          const hit = rows().find(x => conflict.every(c => x[c] === r[c]))
          if (hit) Object.assign(hit, r)
          else rows().push({ id: `${table}-${nextId++}`, ...r })
        }
        return { data: list, count: list.length }
      }
      if (mode === 'update') {
        const hit = matching()
        hit.forEach(r => Object.assign(r, payload))
        return { data: hit, count: hit.length }
      }
      if (mode === 'delete') {
        const hit = matching()
        db[table] = rows().filter(r => !hit.includes(r))
        return { data: hit, count: hit.length }
      }
      let out = matching()
      if (sort) {
        const { col, dir } = sort
        out = [...out].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] as never) > (b[col] as never) ? dir : -dir))
      }
      return { data: head ? null : out.slice(offset, offset + limit), count: out.length }
    }

    const b: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return b },
      insert: (p: Row | Row[]) => { mode = 'insert'; payload = p; return b },
      update: (p: Row) => { mode = 'update'; payload = p; return b },
      upsert: (p: Row | Row[], o?: { onConflict?: string }) => { mode = 'upsert'; payload = p; conflict = (o?.onConflict ?? 'id').split(','); return b },
      delete: () => { mode = 'delete'; return b },
      eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
      neq: (c: string, v: unknown) => { preds.push(r => r[c] !== v); return b },
      lte: (c: string, v: unknown) => { preds.push(r => r[c] != null && String(r[c]) <= String(v)); return b },
      gte: (c: string, v: unknown) => { preds.push(r => String(r[c] ?? '') >= String(v)); return b },
      gt: (c: string, v: unknown) => { preds.push(r => String(r[c] ?? '') > String(v)); return b },
      lt: (c: string, v: unknown) => { preds.push(r => r[c] != null && String(r[c]) < String(v)); return b },
      // Only .not(col, 'is', null)
      not: (c: string, _op: string, _v: unknown) => { preds.push(r => r[c] != null); return b },
      is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
      in: (c: string, vs: unknown[]) => { preds.push(r => vs.includes(r[c])); return b },
      ilike: (c: string, p: string) => { preds.push(r => likeToRegex(p).test(String(r[c] ?? ''))); return b },
      // "<col>.<eq|neq|is|gte|lt>.<value>,…" — any one matching
      or: (expr: string) => {
        const terms = expr.split(',').map(t => {
          const [, col, op, value] = t.match(/^(\w+)\.(eq|neq|is|gte|lt)\.(.+)$/) ?? []
          return (r: Row) => op === 'is' ? (r[col] ?? null) === (value === 'null' ? null : value)
            : op === 'eq' ? String(r[col]) === value
            : op === 'gte' ? r[col] != null && String(r[col]) >= value
            : op === 'lt' ? r[col] != null && String(r[col]) < value
            : r[col] == null || String(r[col]) !== value
        })
        preds.push(r => terms.some(t => t(r)))
        return b
      },
      order: (col: string, o?: { ascending?: boolean }) => { sort = { col, dir: o?.ascending === false ? -1 : 1 }; return b },
      limit: (n: number) => { limit = n; return b },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return b },
      single: async () => {
        const { data } = execute()
        const row = Array.isArray(data) ? data[0] : null
        return row ? { data: row, error: null } : { data: null, error: { message: 'No rows' } }
      },
      maybeSingle: async () => {
        const { data } = execute()
        return { data: Array.isArray(data) ? data[0] ?? null : null, error: null }
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => { const { data, count } = execute(); return { data, count, error: null } }).then(res, rej),
    }
    return b
  }
  // db['rpc:<name>'] holds what a database function returns
  const rpc = async (name: string) => ({ data: db[`rpc:${name}`] ?? null, error: null })
  return { from, rpc }
}

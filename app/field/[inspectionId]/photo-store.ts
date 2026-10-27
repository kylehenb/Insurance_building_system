// Field photos kept on the phone (IndexedDB) from the moment they're
// converted until the inspection is submitted, so iOS reloading Safari while
// the inspector is in another app never loses them. Every call is best effort:
// private browsing or blocked storage just means photos live in memory only.

export type LabelSource = 'none' | 'ai' | 'inspector'

export interface StoredPhoto {
  id: string
  inspectionId: string
  /** Position in the order the inspector added them */
  order: number
  name: string
  /** The converted JPEG, until it's uploaded */
  file: Blob | null
  /** Small preview for the grid */
  thumb: Blob | null
  label: string
  labelSource: LabelSource
  uploaded: boolean
  serverId: string | null
}

const DB_NAME = 'irc-field-photos'
const STORE = 'photos'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('inspectionId', 'inspectionId')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req ? req.result : undefined)
      tx.onerror = () => resolve(undefined)
      tx.onabort = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export const putPhoto = (p: StoredPhoto) => run('readwrite', s => s.put(p))

export async function patchPhoto(id: string, patch: Partial<StoredPhoto>): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const get = store.get(id)
      get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }) }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export const deletePhoto = (id: string) => run('readwrite', s => s.delete(id))

export async function listPhotos(inspectionId: string): Promise<StoredPhoto[]> {
  const rows = await run<StoredPhoto[]>('readonly', s => s.index('inspectionId').getAll(inspectionId))
  return (rows ?? []).sort((a, b) => a.order - b.order)
}

export async function clearInspection(inspectionId: string): Promise<void> {
  const rows = await listPhotos(inspectionId)
  await Promise.all(rows.map(r => deletePhoto(r.id)))
}

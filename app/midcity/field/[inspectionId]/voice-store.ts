// Voice notes kept on the phone (IndexedDB) from the moment they're spoken until
// their text is safely in the job's notes: the audio arrives in small pieces
// every few seconds while recording, so Safari reloading, the phone locking or
// a dropped connection loses at most the last few seconds. Every call is best
// effort: with storage blocked, recording still works, held in memory only.

export type StoredSectionStatus = 'recording' | 'saved' | 'done'

export interface StoredSection {
  id: string
  inspectionId: string
  startedAt: number
  /** null while still recording (or when recording was cut off) */
  endedAt: number | null
  mime: string
  status: StoredSectionStatus
  /** Once turned into text */
  text?: string
  parts?: { start: number; end: number; text: string }[]
}

interface StoredChunk { sectionId: string; n: number; blob: Blob }

const DB_NAME = 'bindi-voice-notes'
let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const sections = req.result.createObjectStore('sections', { keyPath: 'id' })
        sections.createIndex('inspectionId', 'inspectionId')
        const chunks = req.result.createObjectStore('chunks', { keyPath: ['sectionId', 'n'] })
        chunks.createIndex('sectionId', 'sectionId')
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

async function run<T>(storeName: 'sections' | 'chunks', mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise(resolve => {
    try {
      const tx = db.transaction(storeName, mode)
      const req = fn(tx.objectStore(storeName))
      tx.oncomplete = () => resolve(req ? req.result : undefined)
      tx.onerror = () => resolve(undefined)
      tx.onabort = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export const putSection = (s: StoredSection) => run('sections', 'readwrite', st => { st.put(s) })

export const listSections = async (inspectionId: string): Promise<StoredSection[]> =>
  ((await run<StoredSection[]>('sections', 'readonly', st => st.index('inspectionId').getAll(inspectionId))) ?? [])
    .sort((a, b) => a.startedAt - b.startedAt)

export const putChunk = (sectionId: string, n: number, blob: Blob) => run('chunks', 'readwrite', st => { st.put({ sectionId, n, blob } satisfies StoredChunk) })

export const listChunks = async (sectionId: string): Promise<Blob[]> =>
  ((await run<StoredChunk[]>('chunks', 'readonly', st => st.index('sectionId').getAll(sectionId))) ?? [])
    .sort((a, b) => a.n - b.n).map(c => c.blob)

export async function deleteChunks(sectionId: string): Promise<void> {
  const keys = (await run<IDBValidKey[]>('chunks', 'readonly', st => st.index('sectionId').getAllKeys(sectionId))) ?? []
  if (keys.length) await run('chunks', 'readwrite', st => { keys.forEach(k => st.delete(k)) })
}

export async function deleteSection(id: string): Promise<void> {
  await deleteChunks(id)
  await run('sections', 'readwrite', st => { st.delete(id) })
}

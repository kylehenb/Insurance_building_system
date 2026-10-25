// Fitting attachments into one email. Gmail refuses an email over 25 MB, and
// base64 encoding adds a third, so the files themselves must stay under about
// 18 MB. Over that, photos are compressed (largest first); whatever still
// doesn't fit is left out, in the order asked, and reported by name.

/** Raw attachment bytes that stay under Gmail's 25 MB once encoded */
export const ATTACHMENT_BUDGET_BYTES = 18 * 1024 * 1024

export interface BudgetFile {
  filename: string
  mimeType: string
  content: Buffer
}

export interface FittedAttachments<T extends BudgetFile> {
  kept: T[]
  /** Left out because they didn't fit */
  skipped: T[]
  /** File names of photos that went as smaller copies */
  compressed: string[]
}

const isPhoto = (f: BudgetFile) => /^image\/(jpeg|png|webp|heic|heif|tiff|gif)$/i.test(f.mimeType)
const sum = (files: BudgetFile[]) => files.reduce((n, f) => n + f.content.length, 0)

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * files in the order asked; alreadyBytes is what the email already carries
 * (a forward's files, a draft's earlier attachments). compress returns a
 * smaller copy of a photo, or throws to keep the original.
 */
export async function fitAttachments<T extends BudgetFile>(
  files: T[],
  alreadyBytes: number,
  compress: (file: T) => Promise<T>,
  budget = ATTACHMENT_BUDGET_BYTES,
): Promise<FittedAttachments<T>> {
  const list = [...files]
  const compressed: string[] = []
  if (alreadyBytes + sum(list) > budget) {
    const photos = list.map((f, i) => ({ f, i })).filter(x => isPhoto(x.f)).sort((a, b) => b.f.content.length - a.f.content.length)
    for (const { f, i } of photos) {
      if (alreadyBytes + sum(list) <= budget) break
      try {
        const smaller = await compress(f)
        if (smaller.content.length < f.content.length) {
          list[i] = smaller
          compressed.push(f.filename)
        }
      } catch {
        // Keep the original; it may still fit
      }
    }
  }

  const kept: T[] = []
  const skipped: T[] = []
  let total = alreadyBytes
  for (const f of list) {
    if (total + f.content.length <= budget) {
      kept.push(f)
      total += f.content.length
    } else {
      skipped.push(f)
    }
  }
  return { kept, skipped, compressed }
}

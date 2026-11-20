import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { shrinkPhotoForPrint, PRINT_PHOTO_MAX_EDGE } from '../print-photo'

// A noisy "photo" (noise compresses like a detailed site photo, not like a flat colour)
async function photo(width: number, height: number, orientation?: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
  const img = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 82 })
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer()
}

describe('shrinkPhotoForPrint', () => {
  it('brings a field app photo down to print size, much smaller', async () => {
    const input = await photo(1600, 1200)
    const out = await shrinkPhotoForPrint(input)
    expect([out.width, out.height]).toEqual([PRINT_PHOTO_MAX_EDGE, 600])
    expect(out.data.length).toBeLessThan(input.length / 3)
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([800, 600])
  })

  it('applies the phone\'s rotation, so the size is the photo as seen', async () => {
    const out = await shrinkPhotoForPrint(await photo(1600, 1200, 6))
    expect([out.width, out.height]).toEqual([600, 800])
    expect((await sharp(out.data).metadata()).orientation ?? 1).toBe(1)
  })

  it('never enlarges a small photo', async () => {
    const out = await shrinkPhotoForPrint(await photo(400, 300))
    expect([out.width, out.height]).toEqual([400, 300])
  })

  it('throws on something that isn\'t an image', async () => {
    await expect(shrinkPhotoForPrint(Buffer.from([1, 2, 3]))).rejects.toThrow()
  })
})

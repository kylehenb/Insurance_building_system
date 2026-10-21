// Script fonts for typed signatures. Self-hosted from lib/signing/fonts
// (no CDN): the signer page loads them with next/font/local and the PDF
// stamper embeds the same TTF files. Safe to import from client code.

export interface SignatureStyle {
  key: string
  label: string
  /** TTF file in lib/signing/fonts */
  file: string
  /** Point size used when stamping a typed signature, before fitting to the box */
  pdfSize: number
}

export const SIGNATURE_STYLES: SignatureStyle[] = [
  { key: 'great_vibes',    label: 'Style 1', file: 'GreatVibes-Regular.ttf',    pdfSize: 30 },
  { key: 'allura',         label: 'Style 2', file: 'Allura-Regular.ttf',        pdfSize: 32 },
  { key: 'homemade_apple', label: 'Style 3', file: 'HomemadeApple-Regular.ttf', pdfSize: 22 },
]

export const DEFAULT_SIGNATURE_STYLE = SIGNATURE_STYLES[0].key

export function signatureStyleFor(key: string | null | undefined): SignatureStyle {
  return SIGNATURE_STYLES.find(s => s.key === key) ?? SIGNATURE_STYLES[0]
}

/** Longest typed signature accepted. */
export const MAX_TYPED_SIGNATURE_LENGTH = 80

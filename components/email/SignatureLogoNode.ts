import { Node } from '@tiptap/react'

// The signature's logo as a block in the editor: shows the actual image, can
// be dragged to another line, deleted, or inserted at the cursor. Stored as a
// {logo} line (lib/email/rich-text.ts SIGNATURE_LOGO_TOKEN): RichTextEditor
// converts between the two.

export interface SignatureLogoImage {
  url: string
  width: number
  height: number
}

export const LOGO_ELEMENT_ATTR = 'data-signature-logo'

/** Draws the block: the image at its email size, or a placeholder without one. */
export function paintLogo(el: HTMLElement, logo: SignatureLogoImage | null): void {
  el.replaceChildren()
  el.style.cssText = 'display:block;margin:4px 0;cursor:grab;'
  el.title = 'Logo — drag to move it, or select it and press Delete'
  if (logo) {
    const img = document.createElement('img')
    img.src = logo.url
    img.alt = 'Logo'
    img.draggable = false
    img.style.cssText = `display:block;width:${logo.width}px;height:${logo.height}px;max-width:100%;`
    el.appendChild(img)
  } else {
    el.textContent = 'Logo goes here (upload an image below)'
    el.style.cssText += 'padding:6px 10px;border:1px dashed #c9c4bc;border-radius:4px;font-size:12px;color:#8a857e;width:max-content;'
  }
}

export function createSignatureLogoNode(getLogo: () => SignatureLogoImage | null) {
  return Node.create({
    name: 'signatureLogo',
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    parseHTML: () => [{ tag: `div[${LOGO_ELEMENT_ATTR}]` }],
    renderHTML: () => ['div', { [LOGO_ELEMENT_ATTR]: '' }],
    addNodeView: () => () => {
      const dom = document.createElement('div')
      dom.setAttribute(LOGO_ELEMENT_ATTR, '')
      paintLogo(dom, getLogo())
      return { dom }
    },
  })
}

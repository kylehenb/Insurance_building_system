'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import {
  AlignCenter, AlignLeft, Bold, ImageIcon, Italic, Link2, Link2Off, List, ListOrdered, Palette, RemoveFormatting, Strikethrough, Underline,
} from 'lucide-react'
import { RICH_TEXT_COLORS, RICH_TEXT_SIZES, SIGNATURE_LOGO_TOKEN, toRichHtml } from '@/lib/email/rich-text'
import { createSignatureLogoNode, LOGO_ELEMENT_ATTR, paintLogo, type SignatureLogoImage } from './SignatureLogoNode'

// Rich text editor for email templates, Customise send and the signature.
// Offers only formats that render in every mail app (see lib/email/rich-text.ts),
// and strips formatting from pasted text (bold, italics, lists and links stay).
// Enter starts a new line; an empty line is a blank line in the email.

export interface RichTextEditorHandle {
  /** Inserts text (e.g. a {placeholder}) at the cursor */
  insertText(text: string): void
  focus(): void
}

interface Props {
  /** Rich HTML, or older plain text (converted) */
  value: string
  onChange(html: string): void
  onFocus?(): void
  disabled?: boolean
  minHeight?: number
  /** Leave out headings and lists (the signature) */
  compact?: boolean
  /** The signature's logo, placeable in the text (stored as a {logo} line).
   *  null = no image yet; leave out where there's no logo. */
  logo?: SignatureLogoImage | null
}

const LOGO_LINE = `<p>${SIGNATURE_LOGO_TOKEN}</p>`
const LOGO_ELEMENT_RE = new RegExp(`<div ${LOGO_ELEMENT_ATTR}(?:="")?></div>`, 'g')

// Stored form ↔ editor: the {logo} line is the logo block in the editor
const toEditorHtml = (value: string, withLogo: boolean) =>
  withLogo ? toRichHtml(value).split(LOGO_LINE).join(`<div ${LOGO_ELEMENT_ATTR}></div>`) : toRichHtml(value)
const fromEditorHtml = (html: string) => toRichHtml(html.replace(LOGO_ELEMENT_RE, LOGO_LINE))

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, onFocus, disabled = false, minHeight = 260, compact = false, logo },
  ref,
) {
  const withLogo = logo !== undefined
  const logoRef = useRef<SignatureLogoImage | null>(logo ?? null)
  // Created once; the block reads the current logo when it draws (not during render)
  // eslint-disable-next-line react-hooks/refs
  const [logoNode] = useState(() => createSignatureLogoNode(() => logoRef.current))
  const lastEmitted = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  useEffect(() => { onChangeRef.current = onChange; onFocusRef.current = onFocus; logoRef.current = logo ?? null })

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: compact ? false : { levels: [2, 3] },
        bulletList: compact ? false : undefined,
        orderedList: compact ? false : undefined,
        listItem: compact ? false : undefined,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['mailto', 'tel'] },
      }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({ types: compact ? ['paragraph'] : ['heading', 'paragraph'], alignments: ['left', 'center'] }),
      ...(withLogo ? [logoNode] : []),
    ],
    content: toEditorHtml(value, withLogo),
    editorProps: {
      attributes: { class: 'rich-email-content', spellcheck: 'true' },
      // Pasted text takes this email's look; structure (bold, lists, links) stays
      transformPastedHTML: html => html
        .replace(/\s(style|class|color|face|size)="[^"]*"/gi, '')
        .replace(/\s(style|class)='[^']*'/gi, ''),
    },
    onUpdate: ({ editor: e }) => {
      const html = fromEditorHtml(e.getHTML())
      lastEmitted.current = html
      onChangeRef.current(html)
    },
    onFocus: () => onFocusRef.current?.(),
  })

  // A new value from outside (another template opened, Discard changes)
  useEffect(() => {
    if (!editor) return
    const next = toRichHtml(value)
    if (next === lastEmitted.current) return
    lastEmitted.current = next
    editor.commands.setContent(toEditorHtml(next, withLogo), { emitUpdate: false })
  }, [editor, value, withLogo])

  // A new or resized logo: redraw the block(s) in place
  useEffect(() => {
    if (!editor || !withLogo) return
    editor.view.dom.querySelectorAll<HTMLElement>(`[${LOGO_ELEMENT_ATTR}]`).forEach(el => paintLogo(el, logo ?? null))
  }, [editor, withLogo, logo?.url, logo?.width, logo?.height]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])

  useImperativeHandle(ref, () => ({
    insertText(text: string) { editor?.chain().focus().insertContent(text).run() },
    focus() { editor?.commands.focus() },
  }), [editor])

  return (
    <div className={`border border-line-3 rounded-md bg-surface-5 focus-within:border-gold ${disabled ? 'opacity-60' : ''}`}>
      {editor && <Toolbar editor={editor} compact={compact} disabled={disabled} logo={withLogo} />}
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        className={[
          'px-3 py-2.5 text-sm text-ink leading-relaxed cursor-text',
          '[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[inherit]',
          '[&_p]:m-0 [&_p]:min-h-[1.5em]',
          '[&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-snug [&_h3]:text-base [&_h3]:font-bold [&_h3]:leading-snug',
          '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
          '[&_a]:text-[#1a4f8b] [&_a]:underline',
        ].join(' ')}
      />
    </div>
  )
})

function Toolbar({ editor, compact, disabled, logo }: { editor: Editor; compact: boolean; disabled: boolean; logo: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      center: e.isActive({ textAlign: 'center' }),
      link: e.isActive('link'),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      fontSize: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
    }),
  })
  const [colorsOpen, setColorsOpen] = useState(false)

  const chain = () => editor.chain().focus()
  const style = state.h2 ? 'h2' : state.h3 ? 'h3' : 'p'

  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined
    const input = window.prompt('Link address (web page, or an email address)', current ?? 'https://')
    if (input === null) return
    const href = input.trim()
    if (!href || href === 'https://') { chain().extendMarkRange('link').unsetLink().run(); return }
    const normalised = /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : href.includes('@') ? `mailto:${href}` : `https://${href}`
    if (editor.state.selection.empty && !state.link) {
      chain().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href: normalised } }] }).run()
    } else {
      chain().extendMarkRange('link').setLink({ href: normalised }).run()
    }
  }

  // One logo: placing it again moves it to the cursor
  const insertLogo = () => {
    chain()
      .command(({ tr }) => {
        const positions: number[] = []
        tr.doc.descendants((node, pos) => { if (node.type.name === 'signatureLogo') positions.push(pos) })
        for (const pos of positions.reverse()) tr.delete(pos, pos + 1)
        return true
      })
      .insertContent({ type: 'signatureLogo' })
      .run()
  }

  const btn = (active: boolean) =>
    `h-7 min-w-7 px-1.5 inline-flex items-center justify-center rounded text-body-soft transition-colors disabled:opacity-40 ${active ? 'bg-white text-ink shadow-sm border border-line-3' : 'hover:bg-white hover:text-ink border border-transparent'}`
  const sep = <span className="w-px h-5 bg-line-3 mx-0.5" />
  const selectCls = 'h-7 text-xs border border-line-3 rounded bg-white text-body-soft px-1.5 focus:outline-none focus:border-gold disabled:opacity-40'

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-line-3 bg-surface rounded-t-md" onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'SELECT') e.preventDefault() }}>
      {!compact && (
        <select
          aria-label="Text style"
          disabled={disabled}
          value={style}
          onChange={e => {
            const v = e.target.value
            if (v === 'p') chain().setParagraph().run()
            else chain().setHeading({ level: v === 'h2' ? 2 : 3 }).run()
          }}
          className={selectCls}
        >
          <option value="p">Normal text</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
      )}
      <select
        aria-label="Text size"
        disabled={disabled}
        value={RICH_TEXT_SIZES.some(s => s.value === state.fontSize) ? state.fontSize : ''}
        onChange={e => {
          const v = e.target.value
          if (v) chain().setFontSize(v).run()
          else chain().unsetFontSize().run()
        }}
        className={selectCls}
      >
        {RICH_TEXT_SIZES.map(s => <option key={s.label} value={s.value}>{s.label}</option>)}
      </select>
      {sep}
      <button type="button" title="Bold (Ctrl+B)" disabled={disabled} className={btn(state.bold)} onClick={() => chain().toggleBold().run()}><Bold size={14} /></button>
      <button type="button" title="Italic (Ctrl+I)" disabled={disabled} className={btn(state.italic)} onClick={() => chain().toggleItalic().run()}><Italic size={14} /></button>
      <button type="button" title="Underline (Ctrl+U)" disabled={disabled} className={btn(state.underline)} onClick={() => chain().toggleUnderline().run()}><Underline size={14} /></button>
      <button type="button" title="Strikethrough" disabled={disabled} className={btn(state.strike)} onClick={() => chain().toggleStrike().run()}><Strikethrough size={14} /></button>
      <div className="relative">
        <button type="button" title="Text colour" disabled={disabled} className={btn(colorsOpen)} onClick={() => setColorsOpen(o => !o)}>
          <Palette size={14} />
          <span className="ml-0.5 w-3 h-3 rounded-sm border border-line-3" style={{ background: state.color ?? '#1a1a1a' }} />
        </button>
        {colorsOpen && (
          <div className="absolute z-20 top-8 left-0 p-2 bg-white border border-line-3 rounded-md shadow-lg grid grid-cols-4 gap-1.5 w-[136px]">
            {RICH_TEXT_COLORS.map(c => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                onClick={() => {
                  if (c.value === RICH_TEXT_COLORS[0].value) chain().unsetColor().run()
                  else chain().setColor(c.value).run()
                  setColorsOpen(false)
                }}
                className={`w-7 h-7 rounded border ${state.color === c.value ? 'border-ink ring-1 ring-ink' : 'border-line-3'}`}
                style={{ background: c.value }}
              />
            ))}
          </div>
        )}
      </div>
      {sep}
      {!compact && (
        <>
          <button type="button" title="Bulleted list" disabled={disabled} className={btn(state.bullet)} onClick={() => chain().toggleBulletList().run()}><List size={14} /></button>
          <button type="button" title="Numbered list" disabled={disabled} className={btn(state.ordered)} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={14} /></button>
          {sep}
        </>
      )}
      <button type="button" title="Align left" disabled={disabled} className={btn(!state.center)} onClick={() => chain().unsetTextAlign().run()}><AlignLeft size={14} /></button>
      <button type="button" title="Centre" disabled={disabled} className={btn(state.center)} onClick={() => chain().setTextAlign('center').run()}><AlignCenter size={14} /></button>
      {sep}
      <button type="button" title="Add or change a link" disabled={disabled} className={btn(state.link)} onClick={setLink}><Link2 size={14} /></button>
      {state.link && (
        <button type="button" title="Remove link" disabled={disabled} className={btn(false)} onClick={() => chain().extendMarkRange('link').unsetLink().run()}><Link2Off size={14} /></button>
      )}
{logo && (
        <button type="button" title="Put the logo where the cursor is" disabled={disabled} className={`${btn(false)} gap-1 text-xs`} onClick={insertLogo}>
          <ImageIcon size={14} /> Place logo here
        </button>
      )}
      <button type="button" title="Clear formatting" disabled={disabled} className={btn(false)} onClick={() => chain().unsetAllMarks().clearNodes().unsetTextAlign().run()}><RemoveFormatting size={14} /></button>
    </div>
  )
}

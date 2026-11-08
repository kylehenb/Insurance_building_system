// Dot points for report paragraphs such as the roof report's cause of damage:
// an optional lead line, then one "• " point per line. The AI is asked for this
// shape; this tidies what comes back (dashes, "(1)" numbering, points run
// together on one line) so every report reads the same.

export const DOT = '•'

// "(1)", "1.", "1)" or a dash/asterisk/bullet at the start of a line
const MARKER = /^\s*(?:\(\d{1,2}\)|\d{1,2}[.)](?!\d)|[-*•–])\s*/
// "(2) " part-way through a line: a run-together list
const INLINE_NUMBER = /\s+(?=\(\d{1,2}\)\s)/g

/** Points as "• text" lines, the lead line (if any) kept above them */
export function toDotPoints(text: string | null | undefined): string {
  if (!text?.trim()) return ''
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap(line => (/\(\d{1,2}\)\s/.test(line) ? line.split(INLINE_NUMBER) : [line]))
    .map(line => line.trim())
    .filter(Boolean)

  return lines
    .map(line => {
      if (!MARKER.test(line)) return line
      const body = line.replace(MARKER, '').replace(/[;,]\s*$/, '').trim()
      return body ? `${DOT} ${body.charAt(0).toUpperCase()}${body.slice(1)}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Splits text into lines, marking which are dot points (for display with a hanging indent) */
export function splitDotPoints(text: string): Array<{ point: boolean; text: string }> {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => (line.startsWith(DOT) ? { point: true, text: line.slice(DOT.length).trim() } : { point: false, text: line }))
}

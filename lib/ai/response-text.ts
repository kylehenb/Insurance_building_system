import type Anthropic from '@anthropic-ai/sdk'

/**
 * The text of a Claude response. Newer models can return thinking blocks before the
 * text, so read by block type rather than content[0]. Throws on a refusal.
 */
export function getResponseText(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') {
    throw new Error('The AI model declined to process this request')
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

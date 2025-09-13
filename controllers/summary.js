export function buildSummary (text) {
  if (!text || typeof text !== 'string') return ''
  const sentences = text.match(/[^.!?]+[.!?]/g)
  if (!Array.isArray(sentences)) return text.trim()
  return sentences.slice(0, 5).join(' ').trim()
}

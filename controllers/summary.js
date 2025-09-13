export function buildSummary (text) {
  if (!text || typeof text !== 'string') return { text: '', sentences: [] }
  const sentences = text.match(/[^.!?]+[.!?]/g) || [text]
  const top = sentences.slice(0, 5).map(s => s.trim())
  return { text: top.join(' ').trim(), sentences: top }
}

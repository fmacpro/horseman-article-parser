import textrankPkg from 'textrank'

const { TextRank } = textrankPkg

export function buildSummary (text) {
  if (!text || typeof text !== 'string') return { text: '', sentences: [] }
  try {
    const ranked = new TextRank(text, { extractAmount: 5, summaryType: 'array' })
    const sentences = Array.isArray(ranked.summarizedArticle) ? ranked.summarizedArticle : []
    return { text: sentences.join(' ').trim(), sentences }
  } catch {
    const sentences = text.match(/[^.!?]+[.!?]/g) || [text]
    const top = sentences.slice(0, 5)
    return { text: top.join(' ').trim(), sentences: top }
  }
}

import { retext } from 'retext'

const EMPTY_STATS = { readingTime: 0, characters: 0, words: 0, sentences: 0, paragraphs: 0 }

/**
 * Evaluate basic readability statistics and estimate reading time using
 * a structured parse of the text so that sentence/paragraph counts stay
 * aligned with natural language boundaries.
 *
 * @param {string} text raw text input
 * @returns {{readingTime: number, characters: number, words: number, sentences: number, paragraphs: number}}
 */
export default async function checkReadability (text) {
  if (!text || typeof text !== 'string') return { ...EMPTY_STATS }

  const trimmed = text.trim()
  if (!trimmed) return { ...EMPTY_STATS }

  const characters = trimmed.length
  const fallbackWords = trimmed.split(/\s+/).filter(Boolean)

  let words = 0
  let sentences = 0
  let paragraphs = 0

  try {
    const processor = retext()
    const tree = processor.parse(trimmed)

    for (const node of tree.children || []) {
      if (node.type !== 'ParagraphNode') continue
      const sentenceNodes = (node.children || []).filter(child => child.type === 'SentenceNode')
      let sentenceCountForParagraph = 0

      for (const sentenceNode of sentenceNodes) {
        const wordCount = countWordsInSentence(sentenceNode)
        if (wordCount === 0) continue
        sentenceCountForParagraph++
        words += wordCount
      }

      if (sentenceCountForParagraph > 0) {
        paragraphs++
        sentences += sentenceCountForParagraph
      }
    }
  } catch (error) {
    // Fall back to heuristic splitting below if parsing fails.
  }

  if (words === 0) words = fallbackWords.length
  if (sentences === 0) sentences = estimateSentenceCount(trimmed)
  if (paragraphs === 0) paragraphs = estimateParagraphCount(trimmed)

  const readingTime = Math.round((words / 200) * 60)
  return { readingTime, characters, words, sentences, paragraphs }
}

function countWordsInSentence (sentenceNode) {
  if (!sentenceNode || !sentenceNode.children) return 0
  let count = 0
  for (const child of sentenceNode.children) {
    if (child.type !== 'WordNode' || !child.children) continue
    const value = child.children.map(part => (typeof part.value === 'string') ? part.value : '').join('')
    if (value.trim()) count++
  }
  return count
}

function estimateSentenceCount (text) {
  if (!text) return 0
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text))
    return segments.filter(seg => seg.segment && seg.segment.trim()).length
  }
  return text.split(/[.!?]+(?=\s|$)/).filter(part => part.trim().length > 0).length
}

function estimateParagraphCount (text) {
  if (!text) return 0
  const doubleBreaks = text.split(/\r?\n\s*\r?\n+/).map(p => p.trim()).filter(Boolean)
  if (doubleBreaks.length > 0) return doubleBreaks.length
  const singleBreaks = text.split(/\r?\n+/).map(p => p.trim()).filter(Boolean)
  return singleBreaks.length > 0 ? singleBreaks.length : 1
}

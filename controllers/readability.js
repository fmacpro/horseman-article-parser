/**
 * Evaluate basic readability statistics and estimate reading time.
 * Returns an estimated reading time in seconds (assuming ~200 wpm) and
 * basic document statistics (characters, words, sentences, paragraphs).
 *
 * @param {string} text raw text input
 * @returns {{readingTime: number, characters: number, words: number, sentences: number, paragraphs: number}}
 */
export default async function checkReadability (text) {
  if (!text || typeof text !== 'string') return { readingTime: 0, characters: 0, words: 0, sentences: 0, paragraphs: 0 }
  const trimmed = text.trim()
  const characters = trimmed.length
  const words = trimmed.split(/\s+/).filter(Boolean).length
  const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  const paragraphs = trimmed.split(/\n{2,}/).filter(p => p.trim().length > 0).length
  const readingTime = Math.round((words / 200) * 60)
  return { readingTime, characters, words, sentences, paragraphs }
}

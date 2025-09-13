import { retext } from 'retext'
import readability from 'retext-readability'

/**
 * Evaluate readability of text and estimate reading time.
 * Returns an array of readability warnings with algorithm counts
 * and an estimated reading time in seconds (assuming ~200 wpm).
 *
 * @param {string} text raw text input
 * @returns {{scores: Array<{sentence: string, algorithms: number, total: number}>, readingTime: number}}
 */
export default async function checkReadability (text) {
  if (!text || typeof text !== 'string') return { scores: [], readingTime: 0 }
  const file = await retext().use(readability).process(text)
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const readingTime = Math.round((words / 200) * 60)
  const scores = file.messages.map(m => {
    const reason = String(m.reason || '')
    const match = reason.match(/according to (\d+) out of (\d+) algorithms/) || reason.match(/according to all (\d+) algorithms/)
    let algorithms = 0
    let total = 0
    if (match) {
      if (match[2]) { algorithms = Number(match[1]); total = Number(match[2]) }
      else { algorithms = Number(match[1]); total = Number(match[1]) }
    }
    return { sentence: m.actual, algorithms, total }
  })
  return { scores, readingTime }
}

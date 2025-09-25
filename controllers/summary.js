const DEFAULT_MAX_SENTENCES = 5
const FACTUAL_PATTERNS = [
  /\baccording to\b/i,
  /\bdata (shows|showed|reveals|revealed)\b/i,
  /\bfigures? (show|showed|suggests?|suggested|reveals?)\b/i,
  /\bpercent\b/i,
  /\bper cent\b/i,
  /\b(?:million|billion|thousand)\b/i,
  /(?:\u00a3|\$|\u20ac)/,
  /\b(?:study|report|survey)\b/i,
  /\bexperts? (say|said)\b/i
]
const NOISE_PATTERNS = [
  /newsletter/i,
  /subscribe/i,
  /advert/i,
  /cookies?/i,
  /privacy policy/i
]

export function buildSummary (text, context = {}) {
  if (!text || typeof text !== 'string') return { text: '', sentences: [] }
  const working = text.trim()
  if (!working) return { text: '', sentences: [] }

  const {
    title = '',
    metaDescription = '',
    keywords = [],
    maxSentences = DEFAULT_MAX_SENTENCES
  } = context || {}

  const paragraphs = extractParagraphs(working)
  const sentences = segmentSentences(working)
  if (sentences.length === 0) return { text: '', sentences: [] }

  mapSentencesToParagraphs(sentences, paragraphs)

  const titleTokens = toTokenSet(title)
  const metaTokens = toTokenSet(metaDescription)
  const keywordTokens = buildKeywordTokens(keywords)
  const totalSentences = sentences.length

  const scored = sentences.map((sentence, index) => {
    const tokens = toTokenSet(sentence.text)
    let score = 0

    const relativePosition = 1 - (index / totalSentences)
    score += relativePosition * 1.2

    const paragraphFactor = 1 - (sentence.paragraphIndex / Math.max(paragraphs.length, 1))
    score += paragraphFactor * 0.9

    if (sentence.isParagraphStart) score += 0.8
    else if (sentence.positionInParagraph === 2) score += 0.3

    const titleOverlap = countOverlap(tokens, titleTokens)
    if (titleOverlap > 0) score += 0.6 + Math.min(titleOverlap, 4) * 0.25

    const metaOverlap = countOverlap(tokens, metaTokens)
    if (metaOverlap > 0) score += 0.3 + Math.min(metaOverlap, 4) * 0.2

    const keywordOverlap = countOverlap(tokens, keywordTokens)
    if (keywordOverlap > 0) score += 0.2 + Math.min(keywordOverlap, 4) * 0.15

    if (/[0-9]/.test(sentence.text)) score += 0.35
    if (FACTUAL_PATTERNS.some(pattern => pattern.test(sentence.text))) score += 0.25

    const length = sentence.text.length
    const wordCount = sentence.wordCount
    if (length >= 40 && length <= 320) score += 0.2
    if (wordCount >= 8 && wordCount <= 35) score += 0.2
    if (length < 35 || wordCount < 6) score -= 0.6

    if (NOISE_PATTERNS.some(pattern => pattern.test(sentence.text))) score -= 1

    return { ...sentence, score, index }
  })

  let maxPerParagraph = Math.max(1, Math.floor(maxSentences / 3))
  if (paragraphs.length <= 2) maxPerParagraph = maxSentences
  const uniqueTarget = Math.min(paragraphs.length, maxSentences)
  const sorted = scored.sort((a, b) => b.score - a.score)
  const selected = []
  const deferred = []
  const paragraphUsage = new Map()
  const seenTexts = new Set()
  const addCandidate = (candidate) => {
    selected.push(candidate)
    seenTexts.add(candidate.text)
    const usage = (paragraphUsage.get(candidate.paragraphIndex) || 0) + 1
    paragraphUsage.set(candidate.paragraphIndex, usage)
  }
  const findLowestIndex = (predicate) => {
    let index = -1
    let lowest = Infinity
    for (let i = 0; i < selected.length; i += 1) {
      const item = selected[i]
      if (!predicate(item)) continue
      if (item.score < lowest) {
        lowest = item.score
        index = i
      }
    }
    return index
  }

  const ensureCoverage = (minIndex) => {
    if (!Number.isFinite(minIndex) || minIndex <= 0) return
    if (selected.length === 0) return
    if (selected.some(item => item.index >= minIndex)) return
    const candidate = sorted.find(item => item.index >= minIndex && !seenTexts.has(item.text))
    if (!candidate) return
    const candidateUsage = paragraphUsage.get(candidate.paragraphIndex) || 0
    let dropIndex
    if (candidateUsage >= maxPerParagraph) {
      dropIndex = findLowestIndex(item => item.paragraphIndex === candidate.paragraphIndex)
    } else {
      dropIndex = findLowestIndex(item => {
        const usage = paragraphUsage.get(item.paragraphIndex) || 0
        return usage > 1 || item.paragraphIndex !== candidate.paragraphIndex
      })
      if (dropIndex === -1) dropIndex = findLowestIndex(() => true)
    }
    if (dropIndex === -1) return
    const [removed] = selected.splice(dropIndex, 1)
    const removedUsage = (paragraphUsage.get(removed.paragraphIndex) || 1) - 1
    if (removedUsage > 0) paragraphUsage.set(removed.paragraphIndex, removedUsage)
    else paragraphUsage.delete(removed.paragraphIndex)
    seenTexts.delete(removed.text)
    addCandidate(candidate)
  }


  for (const candidate of sorted) {
    if (selected.length >= maxSentences) break
    if (!candidate.text) continue
    if (seenTexts.has(candidate.text)) continue
    const usage = paragraphUsage.get(candidate.paragraphIndex) || 0
    if (usage >= maxPerParagraph) continue
    const paragraphUsed = paragraphUsage.has(candidate.paragraphIndex)
    if (!paragraphUsed || paragraphUsage.size >= uniqueTarget) {
      addCandidate(candidate)
    } else {
      deferred.push(candidate)
    }
  }

  if (selected.length < maxSentences) {
    for (const candidate of deferred) {
      if (selected.length >= maxSentences) break
      if (!candidate.text || seenTexts.has(candidate.text)) continue
      const usage = paragraphUsage.get(candidate.paragraphIndex) || 0
      if (usage >= maxPerParagraph) continue
      addCandidate(candidate)
    }
  }

  if (totalSentences >= 3) {
    ensureCoverage(Math.floor(totalSentences / 3))
    ensureCoverage(Math.floor((totalSentences * 2) / 3))
  }
  if (selected.length === 0) {
    const fallbacks = sentences.slice(0, Math.min(maxSentences, sentences.length)).map(s => s.text)
    const summaryText = fallbacks.join(' ').trim()
    return { text: summaryText, sentences: fallbacks }
  }

  const ordered = selected.sort((a, b) => a.index - b.index)
  const summarySentences = ordered.map(item => item.text)
  const summaryText = summarySentences.join(' ').trim()

  return { text: summaryText, sentences: summarySentences }
}

function segmentSentences (input) {
  if (!input) return []
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
    const segments = Array.from(segmenter.segment(input))
    return segments
      .map(segment => normaliseSegment(segment.segment, segment.index))
      .filter(Boolean)
  }

  const regex = /[^.!?]+[.!?]+|[^.!?\s][^.!?]*$/g
  const results = []
  let match
  while ((match = regex.exec(input)) !== null) {
    const candidate = normaliseSegment(match[0], match.index)
    if (candidate) results.push(candidate)
  }
  return results
}

function normaliseSegment (segment, index) {
  if (!segment) return null
  const trimmedStart = segment.search(/\S/)
  if (trimmedStart === -1) return null
  const trimmed = segment.trim()
  const start = index + trimmedStart
  const end = start + trimmed.length
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  return { text: trimmed, start, end, wordCount }
}

function extractParagraphs (input) {
  let paragraphs = collectParagraphs(input, /\r?\n\s*\r?\n+/g)
  if (paragraphs.length <= 1) {
    const fallback = collectParagraphs(input, /\r?\n+/g)
    if (fallback.length > paragraphs.length) paragraphs = fallback
  }
  if (paragraphs.length === 0) {
    const trimmed = input.trim()
    if (trimmed) paragraphs.push({ text: trimmed, start: 0, end: trimmed.length })
  }
  return paragraphs
}

function collectParagraphs (input, pattern) {
  const results = []
  const flags = (pattern.flags && pattern.flags.includes('g')) ? pattern.flags : ((pattern.flags || '') + 'g')
  const regex = new RegExp(pattern.source, flags)
  let lastIndex = 0
  let match
  while ((match = regex.exec(input)) !== null) {
    addParagraph(results, input, lastIndex, match.index)
    lastIndex = regex.lastIndex
  }
  addParagraph(results, input, lastIndex, input.length)
  return results.filter(Boolean)
}

function addParagraph (store, input, startIndex, endIndex) {
  const slice = input.slice(startIndex, endIndex)
  const first = slice.search(/\S/)
  if (first === -1) return
  const trimmed = slice.trim()
  const start = startIndex + first
  const end = start + trimmed.length
  store.push({ text: trimmed, start, end })
}

function mapSentencesToParagraphs (sentences, paragraphs) {
  if (!Array.isArray(sentences) || !Array.isArray(paragraphs)) return
  let paragraphPointer = 0
  const sentenceCounts = paragraphs.map(() => 0)
  for (const sentence of sentences) {
    while (paragraphPointer < paragraphs.length - 1 && sentence.start >= paragraphs[paragraphPointer].end) {
      paragraphPointer += 1
    }
    const assigned = Math.min(paragraphPointer, paragraphs.length - 1)
    const position = sentenceCounts[assigned] + 1
    sentence.paragraphIndex = assigned
    sentence.positionInParagraph = position
    sentence.isParagraphStart = position === 1
    sentenceCounts[assigned] = position
  }
}

function buildKeywordTokens (keywords) {
  if (!keywords) return new Set()
  const values = []
  if (Array.isArray(keywords)) values.push(...keywords)
  else if (typeof keywords === 'string') values.push(...keywords.split(/[;,\|]/))
  else if (typeof keywords?.text === 'string') values.push(keywords.text)
  const tokens = new Set()
  for (const value of values) {
    for (const token of toTokenSet(value)) tokens.add(token)
  }
  return tokens
}

function toTokenSet (value) {
  if (!value || typeof value !== 'string') return new Set()
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9%\.\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  )
}

function countOverlap (source, target) {
  if (!source || !target || source.size === 0 || target.size === 0) return 0
  let count = 0
  for (const token of source) {
    if (target.has(token)) count += 1
  }
  return count
}






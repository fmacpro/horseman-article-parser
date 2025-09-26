import { retext } from 'retext'
import { toString as nlcstToString } from 'nlcst-to-string'
import pos from 'retext-pos'
import keywords from 'retext-keywords'
import language from 'retext-language'
import { capitalizeFirstLetter, stripPossessive } from '../helpers.js'
import { getStopwordSet, normalizeLanguageCode, normalizeToken, isAllCapsWord } from './languageUtils.js'
const NOISE_PHRASE_PATTERNS = ['squid game', 'ligne frayeur', 'sport business', 'bebes minutes', 'news minute', 'bon plan']

export default async function keywordParser (text, options = { maximum: 10 }) {
  const source = typeof text === 'string' ? text : ''
  const trimmedInput = source.trim()
  if (!trimmedInput) return { keywords: [], keyphrases: [] }

  const safeOptions = { ...(options || {}) }
  const detectedLanguage = safeOptions.language
  const requestedLang = safeOptions.lang
  const resolvedLang = normalizeLanguageCode(requestedLang || detectedLanguage)
  const stopwords = getStopwordSet(resolvedLang)
  const maximum = Number.isFinite(safeOptions.maximum) ? safeOptions.maximum : 10

  delete safeOptions.language
  delete safeOptions.lang
  delete safeOptions.maximum

  const processor = retext()
  if (resolvedLang) processor.use(language, { language: resolvedLang })
  processor.use(pos).use(keywords, { maximum, ...safeOptions })

  const file = await processor.process(trimmedInput)

  const collectedKeywords = []
  const keywordSeen = new Set()

  for (const item of file.data?.keywords || []) {
    const node = item?.matches?.[0]?.node
    if (!node) continue
    const raw = nlcstToString(node)
    const cleaned = cleanKeyword(raw, stopwords)
    if (!cleaned) continue
    const normalized = normalizeToken(cleaned)
    if (!normalized || keywordSeen.has(normalized)) continue
    keywordSeen.add(normalized)
    collectedKeywords.push({ keyword: cleaned, score: item.score })
    if (collectedKeywords.length >= maximum) break
  }

  const collectedKeyphrases = []
  const keyphraseSeen = new Set()

  for (const phrase of file.data?.keyphrases || []) {
    const nodes = phrase?.matches?.[0]?.nodes
    if (!Array.isArray(nodes) || nodes.length === 0) continue
    const raw = nodes.map(node => nlcstToString(node)).join(' ')
    const cleaned = cleanKeyphrase(raw, stopwords)
    if (!cleaned) continue
    const normalized = normalizeToken(cleaned.replace(/\s+/g, ' '))
    if (!normalized || keyphraseSeen.has(normalized)) continue
    keyphraseSeen.add(normalized)
    collectedKeyphrases.push({
      keyphrase: capitalizeFirstLetter(cleaned),
      score: phrase.score,
      weight: phrase.weight
    })
    if (collectedKeyphrases.length >= maximum) break
  }
  const filteredKeyphrases = collectedKeyphrases.filter(item => {
    const normalized = normalizeToken(item.keyphrase.replace(/\s+/g, ' '))
    if (!normalized) return false
    if (normalized.includes('lire aussi')) return false
    for (const pattern of NOISE_PHRASE_PATTERNS) {
      if (normalized.includes(pattern)) return false
    }
    return true
  })

  return { keywords: collectedKeywords, keyphrases: filteredKeyphrases }


}

function cleanKeyword (value, stopwords) {
  if (!value) return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  if (!containsLetter(trimmed)) return ''
  const normalized = normalizeToken(trimmed)
  if (!normalized || normalized.length < 2) return ''
  if (stopwords.has(normalized)) return ''
  if (isAllCapsWord(trimmed) && normalized.length > 4) return ''
  if (/^[0-9]+$/.test(normalized)) return ''
  return capitalizeFirstLetter(stripPossessive(trimmed))
}
function cleanKeyphrase (value, stopwords) {
  if (!value) return ''
  let trimmed = value.replace(/\\s+/g, ' ').trim()
  if (!trimmed || trimmed.length < 4) return ''
  if (!containsLetter(trimmed)) return ''
  const words = extractWords(trimmed)
  if (words.length < 2) return ''
  if (words.length > 12) return ''
  if (trimmed.length > 140) return ''
  const normalizedWords = words.map(normalizeToken).filter(Boolean)
  if (normalizedWords.length === 0) return ''
  const meaningful = normalizedWords.filter(token => token.length > 1 && !stopwords.has(token))
  if (meaningful.length === 0) return ''
  if (meaningful.length === 1 && normalizedWords.length > 3) return ''
  if (stopwords.has(normalizedWords[0]) && meaningful.length <= 3) return ''
  const uniqueness = meaningful.length / words.length
  if (uniqueness < 0.34) return ''
  const uniqueNormalized = new Set(normalizedWords)
  if (uniqueNormalized.size <= 1 && words.length > 2) return ''
  const uppercaseWords = words.filter(word => isAllCapsWord(word))
  if (uppercaseWords.length >= Math.max(2, Math.ceil(words.length * 0.6))) return ''
  const normalizedPhrase = normalizeToken(trimmed.replace(/\\s+/g, ' '))
  for (const pattern of NOISE_PHRASE_PATTERNS) {
    if (normalizedPhrase.includes(pattern)) return ''
  }
  if (normalizedPhrase.includes('lire aussi')) return ''
  trimmed = stripPossessive(trimmed)
  return trimmed
}
function extractWords (value) {
  const matches = value.match(/[\p{L}\p{N}''’]+/gu)
  if (!matches) return []
  return matches
}

function containsLetter (value) {
  return /[\p{L}]/u.test(value)
}








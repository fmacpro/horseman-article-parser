import nlp from 'compromise'
import { fetch as undiciFetch } from 'undici'
import { capitalizeFirstLetter, stripPossessive } from '../helpers.js'
import logger from './logger.js'

const DEFAULT_HINTS = Object.freeze({ first: [], middle: [], last: [], suffix: [], secondary: null })
const COMMON_LAST_SUFFIXES = [
  'sson', 'son', 'sen', 'ez', 'es', 'is', 'os', 'as', 'ian', 'yan', 'ov', 'ova', 'ev', 'eva', 'ski', 'sky', 'stein',
  'berg', 'ford', 'well', 'wood', 'land', 'ton', 'dson', 'dsen', 'man', 'mann', 'vich', 'vych', 'wicz', 'witz', 'escu',
  'opoulos', 'ashvili', 'dottir'
]

export function normalizeEntity (w) {
  if (typeof w !== 'string') return ''
  return w
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9-]+/g, ' ')
    .trim()
    .toLowerCase()
}

function dedupeNameList (values) {
  const seen = new Set()
  const out = []
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = normalizeEntity(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function coerceHints (rawHints) {
  if (!rawHints || typeof rawHints !== 'object') rawHints = DEFAULT_HINTS
  const hints = {
    first: dedupeNameList(rawHints.first || rawHints.firstNames),
    middle: dedupeNameList(rawHints.middle || rawHints.middleNames),
    last: dedupeNameList(rawHints.last || rawHints.lastNames),
    suffix: dedupeNameList(rawHints.suffix || rawHints.suffixes),
    secondary: normalizeSecondaryConfig(rawHints.secondary)
  }
  return hints
}

function buildHintSets (hints) {
  const makeSet = (list) => new Set(list.map(normalizeEntity).filter(Boolean))
  return {
    first: makeSet(hints.first),
    middle: makeSet(hints.middle),
    last: makeSet(hints.last),
    suffix: makeSet(hints.suffix)
  }
}

function startsWithUpper (word) {
  return typeof word === 'string' && /^[\p{Lu}]/u.test(word.trim())
}

function likelySuffix (word, hintSets) {
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  if (hintSets.suffix.has(normalized)) return true
  return /^(?:jr|sr|ii|iii|iv|phd|md|esq)$/i.test(normalized)
}

function likelyLast (word, hintSets) {
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  if (hintSets.last.has(normalized)) return true
  if (COMMON_LAST_SUFFIXES.some(suffix => normalized.endsWith(suffix))) return true
  try {
    const doc = nlp(word)
    if (doc.has('#LastName') || doc.has('#Surname')) return true
  } catch {}
  return false
}

function likelyFirst (word, hintSets) {
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  if (hintSets.first.has(normalized) || hintSets.middle.has(normalized)) return true
  try {
    const doc = nlp(word)
    if (doc.has('#FirstName') || doc.has('#FemaleName') || doc.has('#MaleName')) return true
  } catch {}
  return false
}

function maybeSplitBySpacing (text) {
  if (typeof text !== 'string') return null
  if (!/[\s\u00A0]{2,}|[\r\n]/.test(text)) return null
  const parts = text.split(/\s+/).map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts : null
}

function splitViaSecondary (words, secondaryMap) {
  if (!secondaryMap || secondaryMap.size === 0) return null
  const matches = []
  for (const word of words) {
    const key = normalizeEntity(word)
    if (!key) return null
    const match = secondaryMap.get(key)
    if (!match) return null
    matches.push(match)
  }
  return matches.length > 1 ? matches : null
}

function attemptHeuristicSplit (words, hintSets) {
  if (!Array.isArray(words) || words.length < 2) return null
  if (!words.every(startsWithUpper)) return null
  const suffixCount = words.filter(word => likelySuffix(word, hintSets)).length
  if (suffixCount) return null
  const firstCount = words.filter(word => likelyFirst(word, hintSets)).length
  const lastCount = words.filter(word => likelyLast(word, hintSets)).length
  if (firstCount >= 2 && lastCount === 0) {
    return words.map(capitalizeFirstLetter)
  }
  return null
}

function buildSecondaryMap (names) {
  const map = new Map()
  for (const name of dedupeNameList(names)) {
    const key = normalizeEntity(name)
    if (!key || map.has(key)) continue
    map.set(key, capitalizeFirstLetter(name))
  }
  return map
}

function normalizeSecondaryConfig (raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return { people: dedupeNameList(raw) }
  if (typeof raw === 'function') return { fetcher: raw }
  if (typeof raw !== 'object') return null
  const out = {}
  if (Array.isArray(raw.people)) out.people = dedupeNameList(raw.people)
  if (typeof raw.fetcher === 'function') out.fetcher = raw.fetcher
  if (typeof raw.endpoint === 'string' && raw.endpoint.trim()) {
    out.endpoint = raw.endpoint.trim()
    if (typeof raw.method === 'string') out.method = raw.method.trim()
    if (raw.headers && typeof raw.headers === 'object') out.headers = { ...raw.headers }
    if (typeof raw.field === 'string' && raw.field.trim()) out.field = raw.field.trim()
    if (Number.isFinite(Number(raw.timeoutMs))) out.timeoutMs = Number(raw.timeoutMs)
    if (Number.isFinite(Number(raw.minConfidence))) out.minConfidence = Number(raw.minConfidence)
  }
  return Object.keys(out).length ? out : null
}

async function fetchSecondaryPeople (text, secondaryHints, timeLeft) {
  if (!secondaryHints) return []
  const timeRemaining = typeof timeLeft === 'function' ? timeLeft() : Infinity
  if (timeRemaining <= 0) return []
  if (Array.isArray(secondaryHints.people) && secondaryHints.people.length) {
    return dedupeNameList(secondaryHints.people)
  }
  if (typeof secondaryHints.fetcher === 'function') {
    try {
      const res = await secondaryHints.fetcher(text)
      return dedupeNameList(Array.isArray(res) ? res : res?.people)
    } catch (err) {
      logger.warn('secondary ner fetcher failed', err)
      return []
    }
  }
  if (!secondaryHints.endpoint) return []
  const minConfidence = Number.isFinite(Number(secondaryHints.minConfidence)) ? Number(secondaryHints.minConfidence) : 0
  const method = typeof secondaryHints.method === 'string' ? secondaryHints.method.toUpperCase() : 'POST'
  const headers = { 'content-type': 'application/json', ...(secondaryHints.headers || {}) }
  const field = typeof secondaryHints.field === 'string' && secondaryHints.field.trim() ? secondaryHints.field.trim() : 'text'
  const timeoutMs = Number.isFinite(Number(secondaryHints.timeoutMs)) ? Number(secondaryHints.timeoutMs) : 2000
  if (timeRemaining < timeoutMs * 0.75) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = method === 'GET' ? undefined : JSON.stringify({ [field]: text })
    const res = await undiciFetch(secondaryHints.endpoint, { method, headers, body, signal: controller.signal })
    if (!res.ok) {
      logger.warn('secondary ner request failed', { status: res.status })
      return []
    }
    let data = null
    try { data = await res.json() } catch (err) {
      logger.warn('secondary ner parse failed', err)
      return []
    }
    const names = extractPeopleFromSecondary(data, minConfidence)
    return dedupeNameList(names)
  } catch (err) {
    if (err?.name !== 'AbortError') logger.warn('secondary ner fetch failed', err)
    return []
  } finally {
    clearTimeout(timer)
  }
}

function extractPeopleFromSecondary (data, minConfidence = 0) {
  const out = []
  const push = (val) => {
    if (typeof val !== 'string') return
    const trimmed = val.trim()
    if (trimmed) out.push(trimmed)
  }
  const handleEntity = (entity) => {
    if (!entity || typeof entity !== 'object') return
    const label = String(entity.label || entity.label_ || entity.type || entity.category || '').toUpperCase()
    if (label && label !== 'PERSON') return
    const score = entity.score ?? entity.confidence ?? entity.prob ?? entity.probability
    if (typeof score === 'number' && Number.isFinite(minConfidence) && score < minConfidence) return
    push(entity.text || entity.name || entity.value)
  }
  if (!data) return out
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') push(item)
      else handleEntity(item)
    }
    return out
  }
  if (typeof data !== 'object') return out
  if (Array.isArray(data.people)) data.people.forEach(push)
  if (Array.isArray(data.names)) data.names.forEach(push)
  if (Array.isArray(data.ents)) data.ents.forEach(handleEntity)
  if (Array.isArray(data.entities)) data.entities.forEach(handleEntity)
  if (Array.isArray(data.results)) data.results.forEach(handleEntity)
  if (Array.isArray(data.docs)) {
    for (const doc of data.docs) {
      if (Array.isArray(doc?.ents)) doc.ents.forEach(handleEntity)
      if (Array.isArray(doc?.entities)) doc.entities.forEach(handleEntity)
    }
  }
  if (data.entities && typeof data.entities === 'object') {
    const personList = data.entities.PERSON || data.entities.person || data.entities.people
    if (Array.isArray(personList)) personList.forEach(push)
  }
  return out
}

function maybeSplitPerson (entity, rawText, hintSets, secondaryMap) {
  const raw = typeof rawText === 'string' ? rawText : ''
  let fallback = raw.trim()
  if (!fallback && typeof entity?.text === 'string') fallback = entity.text.trim()
  if (!fallback) return []

  const sanitizedFallback = fallback.replace(/\.(?=\s|$)/g, '').replace(/\s+/g, ' ').trim()
  let canonical = sanitizedFallback
  if (entity.person && (entity.person.honorific || entity.person.firstName || entity.person.middleName || entity.person.lastName)) {
    const parts = [entity.person.honorific, entity.person.firstName, entity.person.middleName, entity.person.lastName]
      .filter(Boolean)
      .map(part => capitalizeFirstLetter(String(part).trim()))
    const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (joined && (!sanitizedFallback || sanitizedFallback === sanitizedFallback.toLowerCase())) {
      canonical = /-/.test(entity.text) ? sanitizedFallback : joined
    }
  }
  const safeCanonical = (canonical || sanitizedFallback || fallback).trim()

  const normalizedLower = raw.replace(/\s+/g, ' ').toLowerCase()
  if (/\b(?:and|or|und|et|y|e)\b/.test(normalizedLower)) return [safeCanonical]
  if (/[\-/'’]/.test(fallback)) return [safeCanonical]

  const spacingSplit = maybeSplitBySpacing(raw)
  if (spacingSplit) return spacingSplit.map(capitalizeFirstLetter)

  const words = fallback.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return [safeCanonical]

  const secondarySplit = splitViaSecondary(words, secondaryMap)
  if (secondarySplit) return secondarySplit

  const heuristicSplit = attemptHeuristicSplit(words, hintSets)
  if (heuristicSplit) return heuristicSplit

  return [safeCanonical]
}

export default async function entityParser (nlpInput, pluginHints = DEFAULT_HINTS, timeLeft = () => Infinity) {
  const doc = nlp(nlpInput)
  const hints = coerceHints(pluginHints)
  const hintSets = buildHintSets(hints)

  const entityToString = (e) => {
    if (Array.isArray(e?.terms) && e.terms.length) {
      let raw = ''
      for (let i = 0; i < e.terms.length; i++) {
        const term = e.terms[i]
        const text = typeof term.text === 'string' ? term.text : ''
        const trimmed = text.trim()
        if (!trimmed) {
          if (typeof term.pre === 'string') raw += term.pre
          if (typeof term.post === 'string') raw += term.post
          continue
        }
        const pre = typeof term.pre === 'string' ? term.pre : (raw ? ' ' : '')
        raw += pre + trimmed
        if (typeof term.post === 'string') raw += term.post
      }
      const cleaned = raw.trim()
      if (cleaned) return cleaned
    }
    if (typeof e?.text === 'string') return e.text.trim()
    return null
  }

  const dedupeEntities = (arr, stripAll = false) => {
    const out = []
    const seen = new Set()
    for (const s of arr) {
      const str = stripPossessive(String(s || '').trim(), stripAll)
      if (!str) continue
      const key = normalizeEntity(str)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(capitalizeFirstLetter(str))
    }
    return out
  }

  const secondaryPeople = await fetchSecondaryPeople(nlpInput, hints.secondary, timeLeft)
  const secondaryMap = buildSecondaryMap(secondaryPeople)

  const result = {}
  doc.people().parse()
  const compromisePeople = doc.people().json().flatMap(p => {
    const text = entityToString(p)
    if (!text) return []
    return maybeSplitPerson(p, text, hintSets, secondaryMap)
  })

  let combinedPeople = compromisePeople
  if (secondaryPeople.length) combinedPeople = combinedPeople.concat(secondaryPeople)

  let people = dedupeEntities(combinedPeople, true)
  const seen = new Set(people.map(name => normalizeEntity(name)))

  if (hints.first.length && hints.last.length) {
    const haystack = normalizeEntity(nlpInput)
    for (const f of hints.first) {
      for (const l of hints.last) {
        const raw = `${f} ${l}`
        const key = normalizeEntity(raw)
        if (haystack.includes(key) && !seen.has(key)) {
          people.push(capitalizeFirstLetter(raw))
          seen.add(key)
        }
      }
    }
  }

  people = dedupeEntities(people, true)
  result.people = people

  if (timeLeft() >= 1000) result.places = dedupeEntities(doc.places().json().map(entityToString))
  if (timeLeft() >= 900) result.orgs = dedupeEntities(doc.organizations().json().map(entityToString))
  if (timeLeft() >= 800) result.topics = dedupeEntities(doc.topics().json().map(entityToString))
  return result
}

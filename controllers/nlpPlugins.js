import nlp from 'compromise'
import logger from './logger.js'

const DEFAULT_HINTS = Object.freeze({ first: [], middle: [], last: [], suffix: [], secondary: null })

function normalizeName (value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9-]+/g, ' ')
    .trim()
    .toLowerCase()
}

function sanitizeSecondaryConfig (raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return { people: dedupeList(raw) }
  if (typeof raw === 'function') return { fetcher: raw }
  if (typeof raw !== 'object') return null
  const out = {}
  if (Array.isArray(raw.people)) out.people = dedupeList(raw.people)
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

function dedupeList (values) {
  const out = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = normalizeName(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function addHint (bucket, value, hints, sets) {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed) return
  const key = normalizeName(trimmed)
  if (!key || sets[bucket].has(key)) return
  sets[bucket].add(key)
  hints[bucket].push(trimmed)
}

function mergeValues (values, bucket, hints, sets) {
  for (const value of Array.isArray(values) ? values : []) addHint(bucket, value, hints, sets)
}

export function loadNlpPlugins (options) {
  const hints = { ...DEFAULT_HINTS, first: [], middle: [], last: [], suffix: [], secondary: null }
  const sets = { first: new Set(), middle: new Set(), last: new Set(), suffix: new Set() }

  const directHints = options?.nlp?.hints
  if (directHints) {
    mergeValues(directHints.first, 'first', hints, sets)
    mergeValues(directHints.middle, 'middle', hints, sets)
    mergeValues(directHints.last, 'last', hints, sets)
    mergeValues(directHints.suffix, 'suffix', hints, sets)
  }

  if (options?.nlp?.secondary) hints.secondary = sanitizeSecondaryConfig(options.nlp.secondary)

  const plugins = Array.isArray(options?.nlp?.plugins) ? options.nlp.plugins : []
  for (const plugin of plugins) {
    try { nlp.plugin(plugin) } catch (err) { logger.warn('nlp plugin load failed', err) }
    try {
      plugin(null, {
        addWords: (words = {}) => {
          for (const [word, tag] of Object.entries(words)) {
            if (!tag) continue
            const normalizedTag = String(tag).toLowerCase()
            if (normalizedTag.startsWith('first')) addHint('first', word, hints, sets)
            else if (normalizedTag.startsWith('middle')) addHint('middle', word, hints, sets)
            else if (normalizedTag.startsWith('suffix')) addHint('suffix', word, hints, sets)
            else if (normalizedTag.startsWith('last')) addHint('last', word, hints, sets)
          }
        }
      })
    } catch (err) { logger.warn('nlp plugin init failed', err) }
  }

  return hints
}

import nlp from 'compromise'
import { capitalizeFirstLetter } from '../helpers.js'

export function normalizeEntity (w) {
  if (typeof w !== 'string') return ''
  return w
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

export default function entityParser (nlpInput, pluginHints = { first: [], last: [] }, timeLeft = () => Infinity) {
  const entityToString = (e) => {
    if (Array.isArray(e?.terms) && e.terms.length) {
      return e.terms.map(t => String(t.text || '').trim()).filter(Boolean).join(' ').trim()
    }
    if (typeof e?.text === 'string') return e.text.trim()
    return null
  }

  const dedupeEntities = (arr) => {
    const out = []
    const seen = new Set()
    for (const s of arr) {
      const str = String(s || '').trim()
      if (!str) continue
      const key = normalizeEntity(str)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(capitalizeFirstLetter(str))
      }
    }
    return out
  }

  const result = {}
  result.people = dedupeEntities(nlp(nlpInput).people().json().map(entityToString))
  const seen = new Set(result.people.map(p => normalizeEntity(p)))
  if (pluginHints.first.length && pluginHints.last.length) {
    const haystack = normalizeEntity(nlpInput)
    for (const f of pluginHints.first) {
      for (const l of pluginHints.last) {
        const raw = `${f} ${l}`
        const key = normalizeEntity(raw)
        if (haystack.includes(key) && !seen.has(key)) {
          result.people.push(capitalizeFirstLetter(raw))
          seen.add(key)
        }
      }
    }
  }
  result.people = dedupeEntities(result.people)
  if (timeLeft() >= 1000) result.places = dedupeEntities(nlp(nlpInput).places().json().map(entityToString))
  if (timeLeft() >= 900) result.orgs = dedupeEntities(nlp(nlpInput).organizations().json().map(entityToString))
  if (timeLeft() >= 800) result.topics = dedupeEntities(nlp(nlpInput).topics().json().map(entityToString))
  return result
}

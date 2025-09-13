import nlp from 'compromise'
import { capitalizeFirstLetter, stripPossessive } from '../helpers.js'

export function normalizeEntity (w) {
  if (typeof w !== 'string') return ''
  return w
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9-]+/g, ' ')
    .trim()
    .toLowerCase()
}

export default function entityParser (nlpInput, pluginHints = { first: [], last: [] }, timeLeft = () => Infinity) {
  const entityToString = (e) => {
    if (Array.isArray(e?.terms) && e.terms.length) {
      const parts = []
      for (let i = 0; i < e.terms.length; i++) {
        const term = e.terms[i]
        let text = String(term.text || '').trim()
        if (!text) continue
        if (/^[’']s$/i.test(text) && parts.length) {
          parts[parts.length - 1] += "'s"
        } else {
          const isHyphen = typeof term.post === 'string' && term.post.trim() === '-' && i < e.terms.length - 1
          parts.push(isHyphen ? text + '-' : text)
        }
      }
      return parts.join(' ').replace(/- /g, '-').trim()
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
      if (!seen.has(key)) {
        seen.add(key)
        out.push(capitalizeFirstLetter(str))
      }
    }
    return out
  }

  const result = {}
  result.people = dedupeEntities(nlp(nlpInput).people().json().map(entityToString), true)
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
  result.people = dedupeEntities(result.people, true)
  if (timeLeft() >= 1000) result.places = dedupeEntities(nlp(nlpInput).places().json().map(entityToString))
  if (timeLeft() >= 900) result.orgs = dedupeEntities(nlp(nlpInput).organizations().json().map(entityToString))
  if (timeLeft() >= 800) result.topics = dedupeEntities(nlp(nlpInput).topics().json().map(entityToString))
  return result
}

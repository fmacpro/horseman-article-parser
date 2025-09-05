import { retext } from 'retext'
import spell from 'retext-spell'
import dictionary from 'dictionary-en-gb'

export default async function spellCheck (text, options) {
  // Pre-clean text: remove bracketed segments and URLs before spellcheck
  let input = text
  // remove anything inside square brackets, e.g. [ ... ]
  input = input.replace(/\[[^\]]*]/g, ' ')
  // remove URLs (http/https/ftp), www.*, and domain-like strings
  input = input.replace(/(?:https?:\/\/|ftp:\/\/)\S+/gi, ' ')
  input = input.replace(/\bwww\.[^\s]+/gi, ' ')
  input = input.replace(/\b[\w-]+(?:\.[\w-]+)+(?:\/\S*)?/gi, ' ')
  // remove alphanumeric tokens like 123abc
  input = input.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, ' ')
  // collapse whitespace
  input = input.replace(/\s+/g, ' ').trim()

  if (typeof options === 'undefined') {
    options = { dictionary }
  }

  if (typeof options.dictionary === 'undefined') {
    options.dictionary = dictionary
  }

  const tweaks = options.tweaks || {}
  const ignoreUrlLike = typeof tweaks.ignoreUrlLike === 'boolean' ? tweaks.ignoreUrlLike : true
  const includeEndPosition = !!tweaks.includeEndPosition
  const includeOffsets = !!tweaks.includeOffsets

  const isUrlLike = (w) => {
    if (!w || typeof w !== 'string') return false
    const s = w.trim()
    if (/^(?:https?:\/\/|www\.)/i.test(s)) return true
    if (/^(?:https?|ftp)$/i.test(s)) return true
    if (/^[\w-]+(?:\.[\w-]+)+$/.test(s) && /[A-Za-z]{2,}$/.test(s)) return true
    if (/^(?:[A-Za-z0-9]+-){4,}[A-Za-z0-9]+$/.test(s)) return true
    return false
  }

  const file = await retext().use(spell, options).process(input)
  const items = file.messages
    .map((m) => {
      const start = m.place && m.place.start ? m.place.start : undefined
      const end = m.place && m.place.end ? m.place.end : undefined
      const base = {
        word: m.actual || m.ruleId || undefined,
        line: start ? start.line : undefined,
        column: start ? start.column : undefined,
        reason: m.reason,
        suggestions: Array.isArray(m.expected) ? m.expected : []
      }
      if (includeEndPosition && end) {
        base.endLine = end.line
        base.endColumn = end.column
      }
      if (includeOffsets && start && end) {
        base.offsetStart = start.offset
        base.offsetEnd = end.offset
      }
      return base
    })
    .filter((item) => {
      if (!ignoreUrlLike) return true
      return !isUrlLike(String(item.word || ''))
    })

  return items
}

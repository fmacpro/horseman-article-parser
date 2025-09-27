import { maskUrlsInText, isUrlLikeToken } from './urlSanitizer.js'
import { retext } from 'retext'
import spell from 'retext-spell'
import dictionary from 'dictionary-en-gb'

export default async function spellCheck (text, options) {
  // Pre-clean text: remove URLs before spellcheck (raw text already strips bracketed segments)
  let input = maskUrlsInText(text)
  // remove alphanumeric tokens like 123abc while preserving layout
  input = input.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, match => ' '.repeat(match.length))
  // collapse spaces but preserve line breaks for accurate line numbers
  input = input.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ')

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
      return !isUrlLikeToken(String(item.word || ''))
    })

  return items
}


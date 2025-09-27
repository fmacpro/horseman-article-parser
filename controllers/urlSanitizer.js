const TOKEN_TRIM_LEADING = /^[\s\u2000-\u206F\u2E00-\u2E7F\p{P}]+/u
const TOKEN_TRIM_TRAILING = /[\s\u2000-\u206F\u2E00-\u2E7F\p{P}]+$/u

const URL_PATTERNS = [
  {
    type: 'data',
    text: /data:[^\s]+/gi,
    token: /^data:[^,\s]+,[^\s]+/i
  },
  {
    type: 'protocol',
    text: /(?:https?:\/\/|ftp:\/\/)[^\s]+/gi,
    token: /^(?:https?:\/\/|ftp:\/\/)[^\s]+$/i
  },
  {
    type: 'www',
    text: /\bwww\.[^\s]+/gi,
    token: /^www\.[^\s]+$/i
  },
  {
    type: 'domain',
    text: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi,
    token: /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?$/i
  }
]

function getPatterns (options = {}) {
  const { dataOnly = false } = options || {}
  return dataOnly ? URL_PATTERNS.filter(p => p.type === 'data') : URL_PATTERNS
}

export function normaliseUrlToken (token) {
  if (!token) return ''
  const trimmed = String(token).trim()
  if (!trimmed) return ''
  return trimmed
    .replace(TOKEN_TRIM_LEADING, '')
    .replace(TOKEN_TRIM_TRAILING, '')
}

export function containsUrlLike (value, options = {}) {
  if (!value) return false
  const text = String(value)
  for (const pattern of getPatterns(options)) {
    const tester = new RegExp(pattern.text.source, pattern.text.flags.replace('g', ''))
    if (tester.test(text)) return true
  }
  return false
}

function replaceUrlLikeInternal (input, replacer, options = {}) {
  if (!input) return input
  let output = String(input)
  const fn = typeof replacer === 'function' ? replacer : () => replacer
  for (const pattern of getPatterns(options)) {
    const regex = new RegExp(pattern.text.source, pattern.text.flags)
    output = output.replace(regex, match => fn(match, pattern.type))
  }
  return output
}

export function stripUrlsFromText (input, options = {}) {
  const { dataOnly = false, replacement = ' ' } = options || {}
  return replaceUrlLikeInternal(input, replacement, { dataOnly })
}

export function stripDataUrlsFromText (input) {
  return stripUrlsFromText(input, { dataOnly: true, replacement: ' ' })
}

export function maskUrlsInText (input, options = {}) {
  const { dataOnly = false } = options || {}
  return replaceUrlLikeInternal(input, match => ' '.repeat(match.length), { dataOnly })
}

export function isUrlLikeToken (token, options = {}) {
  const normalised = normaliseUrlToken(token)
  if (!normalised) return false
  for (const pattern of getPatterns(options)) {
    if (pattern.token.test(normalised)) return true
  }
  return false
}

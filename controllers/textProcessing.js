import cleaner from 'clean-html'
import { htmlToText } from 'html-to-text'
import nlp from 'compromise'
import { JSDOM } from 'jsdom'

const CTA_ATTR_KEYWORDS = [
  'newsletter', 'subscribe', 'subscription', 'signup', 'sign-up', 'sign_up', 'calltoaction', 'call-to-action', 'cta',
  'promo', 'promotion', 'promoted', 'advert', 'ads', 'adunit', 'ad-unit', 'ad_slot', 'sponsor', 'sponsored', 'sponsorship',
  'related', 'recirc', 'recirculation', 'readmore', 'read-more', 'readnext', 'read-next', 'mostread', 'most-read',
  'mostpopular', 'most-popular', 'popular', 'trending', 'recommended', 'recommendation', 'outbrain', 'taboola',
  'share', 'social', 'follow', 'followus', 'follow-us', 'follow_btn', 'email-signup', 'email_signup', 'optin', 'opt-in',
  'marketing', 'commerce', 'partner-link', 'affiliate'
]

const CTA_TEXT_KEYWORDS = [
  'sign up', 'sign me up', 'sign in', 'subscribe', 'subscription', 'newsletter', 'call to action', 'cta', 'join now',
  'join today', 'join us', 'get started', 'get the latest', 'get updates', 'get our', 'read more', 'read next', 'watch now',
  'listen now', 'learn more', 'share this', 'share on', 'follow us', 'follow on', 'follow the', 'donate', 'support us',
  'support our', 'buy now', 'shop now', 'order now', 'start trial', 'start your trial', 'start free trial', 'start a free trial',
  'log in', 'log on', 'login', 'register', 'register now', 'register today', 'advertisement', 'advertiser', 'sponsored content',
  'paid post', 'promo code'
]

const ALWAYS_REMOVE_TAGS = new Set(['NAV', 'FOOTER'])

const sentenceSplitter = /[.!?]+/g

function normalizeWhitespace (text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getMeaningfulText (node) {
  if (!node || typeof node.textContent !== 'string') return ''
  const text = normalizeWhitespace(node.textContent)
  if (!text) return ''
  if (!/[\p{L}\p{N}]/u.test(text)) return ''
  return text
}

function hasMeaningfulText (node) {
  return getMeaningfulText(node).length > 0
}

function nodeDepth (node) {
  let depth = 0
  let current = node
  while (current && current.parentElement) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

function collectAttributeSignals (node) {
  const signals = []
  try {
    if (typeof node.id === 'string' && node.id) signals.push(node.id)
  } catch {}
  try {
    if (node.classList && node.classList.length) {
      signals.push(...Array.from(node.classList).filter(Boolean))
    } else if (typeof node.className === 'string' && node.className) {
      signals.push(node.className)
    }
  } catch {}
  try {
    if (typeof node.getAttributeNames === 'function') {
      const names = node.getAttributeNames()
      for (const name of names) {
        if (!name) continue
        if (name === 'id' || name === 'class' || name === 'style') continue
        if (!/^data-|^aria-|^role$/i.test(name) && !/name$/i.test(name)) continue
        const value = node.getAttribute(name)
        if (typeof value === 'string' && value.trim()) signals.push(value)
      }
    }
  } catch {}
  return signals.join(' ').toLowerCase()
}

function shouldRemoveByAttributes (node, textLen) {
  if (!node || !node.parentNode) return false
  const haystack = collectAttributeSignals(node)
  if (!haystack) return false
  if (textLen > 800) return false
  for (const keyword of CTA_ATTR_KEYWORDS) {
    if (haystack.includes(keyword)) return true
  }
  return false
}

function anchorTextLength (node) {
  if (!node || typeof node.querySelectorAll !== 'function') return 0
  let total = 0
  try {
    const anchors = node.querySelectorAll('a')
    for (const anchor of anchors) {
      total += getMeaningfulText(anchor).length
    }
  } catch {}
  return total
}

function countSentences (text) {
  if (!text) return 0
  const pieces = String(text).split(sentenceSplitter)
  return pieces.filter(part => normalizeWhitespace(part).length > 0).length
}

function shouldRemoveByText (node, text) {
  if (!text) return false
  const textLen = text.length
  const lower = text.toLowerCase()
  if (textLen <= 400) {
    for (const keyword of CTA_TEXT_KEYWORDS) {
      if (lower.includes(keyword)) {
        if (countSentences(text) <= 2) return true
        break
      }
    }
  }
  if (textLen <= 600) {
    const anchorLen = anchorTextLength(node)
    if (anchorLen > 0 && anchorLen >= textLen * 0.9) return true
  }
  return false
}

export function getRawText (html) {
  const options = {
    wordwrap: null,
    noLinkBrackets: true,
    ignoreHref: true,
    ignoreImage: true,
    tables: true,
    uppercaseHeadings: false,
    unorderedListItemPrefix: ''
  }
  let rawText = htmlToText(html, options)
  rawText = nlp(rawText).out('text')
  const containsUrlLike = (s) => {
    if (!s) return false
    const str = String(s)
    if (/(?:https?:\/\/|ftp:\/\/)/i.test(str)) return true
    if (/\bwww\.[^\s\]]+/i.test(str)) return true
    if (/\b[\w-]+(?:\.[\w-]+)+(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/i.test(str)) return true // eslint-disable-line no-useless-escape
    return false
  }
  rawText = rawText.replace(/\[[^\]]*\]/g, m => {
    const inner = m.slice(1, -1)
    return containsUrlLike(inner) ? ' ' : m
  })
  const stripUrls = (s) => {
    if (!s || typeof s !== 'string') return s
    let out = s.replace(/(?:https?:\/\/|ftp:\/\/)[^\s]+/gi, ' ')
    out = out.replace(/\bwww\.[^\s]+/gi, ' ')
    out = out.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi, ' ') // eslint-disable-line no-useless-escape
    return out
  }
  rawText = stripUrls(rawText)
  return rawText.replace(/\s+/g, ' ').trim()
}

export function getFormattedText (html, title, baseurl, options = {
  wordwrap: 100,
  noLinkBrackets: true,
  ignoreHref: true,
  tables: true,
  uppercaseHeadings: true,
  linkHrefBaseUrl: baseurl
}) {
  if (typeof options.linkHrefBaseUrl === 'undefined') {
    options.linkHrefBaseUrl = baseurl
  }
  const text = htmlToText(html, options)
  if (options.uppercaseHeadings === true) {
    title = title.toUpperCase()
  }
  return title + '\n\n' + text
}

export function getHtmlText (text) {
  const textArray = text.replace('\r\n', '\n').split('\n')
  const codeLength = textArray.length
  textArray.forEach((line, index, array) => {
    if (codeLength === index) return
    if (index === 2) line = line.trim()
    array[index] = '<span>' + line + '</span>'
  })
  return textArray.join('\n')
}

export function htmlCleaner (html, options = {
  'add-remove-tags': ['blockquote', 'span'],
  'remove-empty-tags': ['span'],
  'replace-nbsp': true
}) {
  return new Promise((resolve) => {
    cleaner.clean(html, options, function (out) {
      resolve(out)
    })
  })
}

export function stripNonArticleElements (html) {
  if (typeof html !== 'string' || !html.trim()) return typeof html === 'string' ? html : ''
  let dom
  try {
    dom = new JSDOM(`<body>${html}</body>`)
  } catch {
    try {
      dom = new JSDOM(html)
    } catch {
      return html
    }
  }
  const { document, NodeFilter } = dom.window
  const root = document.body || document.documentElement
  if (!root) {
    dom.window.close()
    return html
  }

  const removeNode = (node) => {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node)
    }
  }

  const staticSelectors = [
    'script', 'style', 'noscript', 'template', 'iframe', 'canvas', 'svg', 'picture', 'source',
    'video', 'audio', 'track', 'map', 'object', 'embed'
  ]
  for (const sel of staticSelectors) {
    for (const node of Array.from(root.querySelectorAll(sel))) removeNode(node)
  }

  const interactiveSelectors = [
    'form', 'button', 'input', 'select', 'textarea', 'label', 'details', 'summary', 'dialog'
  ]
  for (const sel of interactiveSelectors) {
    for (const node of Array.from(root.querySelectorAll(sel))) removeNode(node)
  }

  for (const node of Array.from(root.querySelectorAll('[role="button"], [role="link"], [role="menu"], [role="dialog"]'))) {
    removeNode(node)
  }

  for (const anchor of Array.from(root.querySelectorAll('a'))) {
    if (!hasMeaningfulText(anchor)) removeNode(anchor)
  }

  for (const li of Array.from(root.querySelectorAll('li'))) {
    if (!hasMeaningfulText(li)) removeNode(li)
  }

  for (const figure of Array.from(root.querySelectorAll('figure'))) {
    const caption = figure.querySelector('figcaption')
    if (caption && !hasMeaningfulText(caption)) removeNode(caption)
    if (!hasMeaningfulText(figure)) removeNode(figure)
  }

  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter?.SHOW_ELEMENT || 1)
  while (walker.nextNode()) nodes.push(walker.currentNode)
  nodes.sort((a, b) => nodeDepth(b) - nodeDepth(a))

  for (const node of nodes) {
    if (!node || !node.parentNode) continue
    if (node === root) continue
    const tag = node.tagName
    if (ALWAYS_REMOVE_TAGS.has(tag)) {
      removeNode(node)
      continue
    }
    const text = getMeaningfulText(node)
    if (!text) {
      removeNode(node)
      continue
    }
    const textLen = text.length
    if (shouldRemoveByAttributes(node, textLen)) {
      removeNode(node)
      continue
    }
    if (shouldRemoveByText(node, text)) {
      removeNode(node)
    }
  }

  const cleaned = root.innerHTML
  dom.window.close()
  return cleaned
}

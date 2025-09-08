import cleaner from 'clean-html'
import { htmlToText } from 'html-to-text'
import nlp from 'compromise'

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
  rawText = nlp(rawText).normalize().out('text')
  const containsUrlLike = (s) => {
    if (!s) return false
    const str = String(s)
    if (/(?:https?:\/\/|ftp:\/\/)/i.test(str)) return true
    if (/\bwww\.[^\s\]]+/i.test(str)) return true
    if (/\b[\w-]+(?:\.[\w-]+)+(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/i.test(str)) return true
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
    out = out.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi, ' ')
    return out
  }
  rawText = stripUrls(rawText)
  return rawText.replace(/\s+/g, ' ').trim()
}

export function getFormattedText (html, title, baseurl, options) {
  if (typeof options === 'undefined') {
    options = {
      wordwrap: 100,
      noLinkBrackets: true,
      ignoreHref: true,
      tables: true,
      uppercaseHeadings: true,
      linkHrefBaseUrl: baseurl
    }
  }
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

export function htmlCleaner (html, options) {
  return new Promise((resolve) => {
    if (typeof options === 'undefined') {
      options = {
        'add-remove-tags': ['blockquote', 'span'],
        'remove-empty-tags': ['span'],
        'replace-nbsp': true
      }
    }
    cleaner.clean(html, options, function (out) {
      resolve(out)
    })
  })
}

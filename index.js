import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

import fs from 'fs'
import cleaner from 'clean-html'
import Sentiment from 'sentiment'
import { htmlToText } from 'html-to-text'
import nlp from 'compromise'
import absolutify from 'absolutify'
import { JSDOM, VirtualConsole } from 'jsdom'
import { extractStructuredData } from './controllers/structuredData.js'
import { detectContent } from './controllers/contentDetector.js'
import jquery from 'jquery'
import { createRequire } from 'module'
import { setDefaultOptions, capitalizeFirstLetter } from './helpers.js'
import keywordParser from './controllers/keywordParser.js'
import lighthouseAnalysis from './controllers/lighthouse.js'
import spellCheck from './controllers/spellCheck.js'

const require = createRequire(import.meta.url)

/**
 * main article parser module export function
 *
 * @param {Object} options - the options object
 * @param {Object} socket - the optional socket
 *
 * @return {Object} article parser results object
 *
 */

export async function parseArticle (options, socket = { emit: (type, status) => console.log(status) }) {

  options = setDefaultOptions(options)

  // Allow nlp plugins to be passed in (https://observablehq.com/@spencermountain/compromise-plugins)
  if (options.nlp.plugins.length >= 1) {
    for (const plugin of options.nlp.plugins) {
      nlp.extend(plugin)
    }
  }

  const browser = await puppeteer.launch(options.puppeteer.launch)

  try {
    const article = await articleParser(browser, options, socket)

    if (options.enabled.includes('lighthouse')) {
      article.lighthouse = await lighthouseAnalysis(browser, options, socket)
    }

    return article
  } finally {
    await browser.close()
  }
}

/**
 * article scraping function
 *
 * @param {Object} options - the options object
 * @param {Object} socket - the optional socket
 *
 * @return {Object} article parser results object
 *
 */

const articleParser = async function (browser, options, socket) {
  const article = {}
  article.meta = {}
  article.meta.title = {}
  article.links = []
  article.title = {}
  article.excerpt = ''
  article.processed = {}
  article.processed.text = {}
  article.lighthouse = {}

  socket.emit('parse:status', 'Starting Horseman')
  const page = await browser.newPage()

  try {
    // Ignore content security policies
    await page.setBypassCSP(options.puppeteer.setBypassCSP)

    // Optional: set user agent and extra headers from options
    if (options.puppeteer && options.puppeteer.userAgent) {
      await page.setUserAgent(options.puppeteer.userAgent)
    }
    if (options.puppeteer && options.puppeteer.extraHTTPHeaders) {
      await page.setExtraHTTPHeaders(options.puppeteer.extraHTTPHeaders)
    }

    await page.setRequestInterception(true)

    const blockedResourceTypes = new Set(options.blockedResourceTypes)
    const skippedResources = new Set(options.skippedResources)

    page.on('request', request => {
      let requestUrl
      try {
        const url = new URL(request.url())
        requestUrl = url.origin + url.pathname
      } catch {
        requestUrl = request.url()
      }
      if (
        blockedResourceTypes.has(request.resourceType()) ||
        [...skippedResources].some(resource => requestUrl.includes(resource))
      ) {
        request.abort()
      } else {
        request.continue()
      }
    })

    // Inject jQuery from local package to avoid external network fetch
    const jquerySource = await fs.promises.readFile(
      require.resolve('jquery/dist/jquery.min.js'),
      'utf8'
    )

    let response
    try {
      response = await page.goto(options.url, options.puppeteer.goto)
    } catch (e) {
      const message = 'Failed to fetch ' + options.url + ': ' + e.message
      socket.emit('parse:status', message)
      throw new Error(message)
    }

  // Inject cookies if set
  if (typeof options.puppeteer.cookies !== 'undefined') {
    await page.setCookie(...options.puppeteer.cookies)
  }

  // Click buttons if defined (for dismissing privacy popups etc)
  if (typeof options.clickelements !== 'undefined') {
    let clickelement = ''

    for (clickelement of options.clickelements) {
      if (await page.$(clickelement) !== null) {
        await page.click(clickelement)
      }
    }
  }

    await page.evaluate(jquerySource)

  socket.emit('parse:status', 'Fetching ' + options.url)

  // Evaluate status
  article.status = response.request().response().status()

  socket.emit('parse:status', 'Status ' + article.status)

  if (article.status === 403 || article.status === 404) {
    const message = 'Failed to fetch ' + options.url + ' ' + article.status
    socket.emit('parse:status', message)
    throw new Error(message)
  }

  // Evaluate URL
  article.url = response.request().response().url()

  const pathArray = article.url.split('/')
  const protocol = pathArray[0]
  const host = pathArray[2]

  article.host = host
  article.baseurl = protocol + '//' + host

  // Evaluate title
  article.meta.title.text = await page.title()

  // Take mobile screenshot
  if (options.enabled.includes('screenshot')) {
    socket.emit('parse:status', 'Taking Mobile Screenshot')
    article.mobile = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 })
  }

  // Evaluate site icon url
  if (options.enabled.includes('siteicon')) {
    socket.emit('parse:status', 'Evaluating site icon')
    article.siteicon = await page.evaluate(() => {
      const j = window.$
      return j('link[rel~="icon"]').prop('href')
    })
  }

  // Evaluate meta
  socket.emit('parse:status', 'Evaluating Meta Data')

  const meta = await page.evaluate(() => {
    const j = window.$

    const arr = j('meta')
    const meta = {}

    for (let i = 0; i < arr.length; i++) {
      if (j(arr[i]).attr('name')) {
        meta[j(arr[i]).attr('name')] = j(arr[i]).attr('content')
      } else if (j(arr[i]).attr('property')) {
        meta[j(arr[i]).attr('property')] = j(arr[i]).attr('content')
      } else {
        // do nothing for now
      }
    }
    return meta
  })

  // Assign meta
  Object.assign(article.meta, meta)

  // Assign meta description
  const metaDescription = article.meta.description
  article.meta.description = {}
  article.meta.description.text = metaDescription

  // Save the original HTML of the document
  article.html = await page.evaluate(() => {
    const j = window.$
    return j('html').html()
  })

  // HTML Cleaning
  let html = await page.evaluate((options) => {
    const j = window.$

    for (let i = 0; i < options.length; i++) {
      j(options[i]).remove()
    }

    return j('html').html()
  }, options.striptags)

  // More HTML Cleaning
  html = await htmlCleaner(html, options.cleanhtml)

  // Body Content Identification
  socket.emit('parse:status', 'Evaluating Content')

  // Readability options no longer used

  const vc1 = new VirtualConsole()
  vc1.sendTo(console, { omitJSDOMErrors: true })
  const dom = new JSDOM(html, { virtualConsole: vc1 })

  // Legacy readability prep removed; using structured/heuristic detection instead

  // Derived Title & Content (structured-data aware detector always enabled)
  const sd = extractStructuredData(dom.window.document)
  const detected = detectContent(dom.window.document, options, sd)
  const { detectTitle } = await import('./controllers/titleDetector.js')
  article.title.text = detectTitle(dom.window.document, sd) || article.title.text
  let content = detected.html
  article.bodySelector = detected.selector || null
  article.bodyXPath = detected.xpath || null

  if (!content) {
    // As a last resort, use full body HTML
    if (dom.window.document.body) {
      content = dom.window.document.body.innerHTML
      if (!article.bodySelector) article.bodySelector = 'body'
      if (!article.bodyXPath) article.bodyXPath = '/HTML/BODY'
    } else {
      content = html
    }
  }

  // Emit body container details as early as possible, after content detection/fallback
  try {
    const selectorMsg = 'Body container selector: ' + (article.bodySelector || '(not detected)')
    const xpathMsg = 'Body container xpath: ' + (article.bodyXPath || '(not detected)')
    socket.emit('parse:status', selectorMsg)
    socket.emit('parse:status', xpathMsg)
  } catch { /* ignore */ }

  // Title & Content based on defined config rules
  if ( options.rules ) {

    let rules = options.rules;

    for ( let i = 0; i < rules.length; i++ ) {

      if ( article.host === rules[i].host ) {

        if ( rules[i].title ) {

          article.title.text = await page.evaluate( rules[i].title )

        }

        if ( rules[i].content ) {

          content = await page.evaluate( rules[i].content )

        }

      }

    }

  }

  // Turn relative links into absolute links & assign processed html
  article.processed.html = await absolutify(content, article.baseurl)

  // Get in article links
  if (options.enabled.includes('links')) {
    socket.emit('parse:status', 'Evaluating Links')

    const vc2 = new VirtualConsole()
    vc2.sendTo(console, { omitJSDOMErrors: true })
    const { window } = new JSDOM(article.processed.html, { virtualConsole: vc2 })
    const $ = jquery(window)

    const arr = window.$('a')
    const links = []
    let i = 0

    for (i = 0; i < arr.length; i++) {
      const link = { href: $(arr[i]).attr('href'), text: $(arr[i]).text() }
      links.push(link)
    }

    Object.assign(article.links, links)
  }

  // Formatted Text (including new lines and spacing for spell check)
  article.processed.text.formatted = await getFormattedText(article.processed.html, article.title.text, article.baseurl, options.htmltotext)

  // HTML Text (spans on each line for spell check line numbers)
  article.processed.text.html = await getHtmlText(article.processed.text.formatted)

  // Raw Text (text prepared for keyword analysis & named entity recongnition)
  article.processed.text.raw = await getRawText(article.processed.html)

  // Excerpt
  article.excerpt = capitalizeFirstLetter(article.processed.text.raw.replace(/^(.{200}[^\s]*).*/, '$1'))

  // Sentiment
  if (options.enabled.includes('sentiment')) {
    socket.emit('parse:status', 'Sentiment Analysis')

    const sentiment = new Sentiment()

    article.sentiment = sentiment.analyze(article.processed.text.raw)
    if (article.sentiment.score > 0.05) {
      article.sentiment.result = 'Positive'
    } else if (article.sentiment.score < 0.05) {
      article.sentiment.result = 'Negative'
    } else {
      article.sentiment.result = 'Neutral'
    }
  }

  // Named Entity Recognition
  if (options.enabled.includes('entities')) {
    socket.emit('parse:status', 'Named Entity Recognition')

    // People
    article.people = nlp(article.processed.text.raw).people().json()

    // Places
    article.places = nlp(article.processed.text.raw).places().json()

    // Orgs & Places
    article.orgs = nlp(article.processed.text.raw).organizations().json()

    // Topics
    article.topics = nlp(article.processed.text.raw).topics().json()
  }

  // Spelling
  if (options.enabled.includes('spelling')) {
    socket.emit('parse:status', 'Check Spelling')

    article.spelling = await spellCheck(article.processed.text.formatted, options.retextspell)

    // Filter spelling results using known entities (people, orgs, places)
    const normalize = (w) => {
      if (typeof w !== 'string') return ''
      return w
        .replace(/[’']/g, '') // remove apostrophes
        .replace(/[^A-Za-z0-9]+/g, ' ') // non-alphanumerics to space
        .trim()
        .toLowerCase()
    }

    const splitWords = (s) => normalize(s).split(/\s+/).filter(Boolean)

    const collectEntityWords = (arr) => {
      const out = []
      if (!Array.isArray(arr)) return out
      for (const e of arr) {
        if (e && typeof e.text === 'string') out.push(...splitWords(e.text))
        if (Array.isArray(e.terms)) {
          for (const t of e.terms) {
            if (t && typeof t.text === 'string') out.push(...splitWords(t.text))
          }
        }
      }
      return out
    }

    const knownWords = new Set([
      ...collectEntityWords(article.people || []),
      ...collectEntityWords(article.orgs || []),
      ...collectEntityWords(article.places || [])
    ])

    article.spelling = article.spelling.filter((item) => {
      const word = String(item.word || '')
      const tokens = splitWords(word)
      if (tokens.length === 0) return true
      // consider also singular form if token ends with s
      for (const tok of tokens) {
        const t = tok
        const tSingular = t.endsWith('s') && t.length > 1 ? t.slice(0, -1) : null
        if (knownWords.has(t) || (tSingular && knownWords.has(tSingular))) {
          return false
        }
      }
      return true
    })
  }

  // Evaluate keywords & keyphrases
  if (options.enabled.includes('keywords')) {
    socket.emit('parse:status', 'Evaluating Keywords')

    // Evaluate meta title keywords & keyphrases
    Object.assign(article.meta.title, await keywordParser(article.meta.title.text, options.retextkeywords))

    // Evaluate derived title keywords & keyphrases
    Object.assign(article.title, await keywordParser(article.title.text, options.retextkeywords))

    // Evaluate meta description keywords & keyphrases
    Object.assign(article.meta.description, await keywordParser(article.meta.description.text, options.retextkeywords))

    // Evaluate processed content keywords & keyphrases
    Object.assign(article.processed, await keywordParser(article.processed.text.raw, options.retextkeywords))
  }

  socket.emit('parse:status', 'Horseman Anaysis Complete')

    return article
  } finally {
    await page.close()
  }
}

/**
 * takes the article body and returns the raw text of the article
 *
 * @param {String} html - the html string to process
 *
 * @return {String} raw text of the article in lower case
 *
 */

const getRawText = function (html) {
  return new Promise(function (resolve) {
    // Lowercase for analysis
    const options = {
      wordwrap: null,
      noLinkBrackets: true,
      ignoreHref: true,
      ignoreImage: true,
      tables: true,
      uppercaseHeadings: false,
      unorderedListItemPrefix: ''
    }

  // HTML > Text
  let rawText = htmlToText(html, options)

  // Normalise
  rawText = nlp(rawText)
  rawText.normalize()
  rawText = rawText.out('text')

  // Remove only square-bracketed segments that contain URL-like text
  const containsUrlLike = (s) => {
    if (!s) return false
    const str = String(s)
    if (/(?:https?:\/\/|ftp:\/\/)/i.test(str)) return true
    if (/\bwww\.[^\s\]]+/i.test(str)) return true
    if (/\b[\w-]+(?:\.[\w-]+)+(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/i.test(str)) return true
    return false
  }
  rawText = rawText.replace(/\[[^\]]*\]/g, (m) => {
    const inner = m.slice(1, -1)
    return containsUrlLike(inner) ? ' ' : m
  })
  rawText = rawText.replace(/\s+/g, ' ').trim()

  resolve(rawText)
  })
}

/**
 * takes the article body and the derived title and returns the formatted text of the article with links made absolute.
 *
 * @param {String} html - the body html string to process
 * @param {String} title - the title string to process
 * @param {String} baseurl - the base url of the page being scraped
 * @param {Object} options - the [htmltotext]{@link https://github.com/werk85/node-html-to-text} formatting options
 *
 * @return {String} formatted text of the article
 *
 */

const getFormattedText = function (html, title, baseurl, options) {
  return new Promise(function (resolve) {
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

    // HTML > Text
    const text = htmlToText(html, options)

    // If uppercase is set uppercase the title
    if (options.uppercaseHeadings === true) {
      title = title.toUpperCase()
    }

    const formattedText = title + '\n\n' + text

    resolve(formattedText)
  })
}

/**
 * takes the formatted article body text and returns the "clean" html text of the article
 *
 * @param {String} text - the formatted text string to process
 *
 * @return {String} the clean html text of the article
 *
 */

const getHtmlText = function (text) {
  return new Promise(function (resolve) {
    // Replace windows line breaks with linux line breaks & split each line into array
    const textArray = text.replace('\r\n', '\n').split('\n')
    // Check length of text array (no of lines)
    const codeLength = textArray.length
    // Wrap each line in a span
    textArray.forEach(function (line, index, array) {
      if (codeLength === index) return
      if (index === 2) line = line.trim()
      array[index] = '<span>' + line + '</span>'
    })
    // Join each line back into a string
    const htmlText = textArray.join('\n')

    // return raw, formatted & html text
    resolve(htmlText)
  })
}

/**
 * takes a string of html and runs it through [clean-html]{@link https://github.com/dave-kennedy/clean-html}
 *
 * @param {String} html - the html to clean
 * @param {Object} options - the [clean-html options]{@link https://github.com/dave-kennedy/clean-html#options}
 *
 * @return {String} the cleaned html
 *
 */

const htmlCleaner = function (html, options) {
  return new Promise(function (resolve) {
    if (typeof options === 'undefined') {
      options = {
        'add-remove-tags': ['blockquote', 'span'],
        'remove-empty-tags': ['span'],
        'replace-nbsp': true
      }
    }

    cleaner.clean(html, options, function (html) {
      resolve(html)
    })
  })
}
// Legacy title helpers removed; using controllers/titleDetector instead

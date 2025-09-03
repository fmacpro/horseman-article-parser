import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

import fs from 'fs'
import cleaner from 'clean-html'
import Sentiment from 'sentiment'
import { htmlToText } from 'html-to-text'
import nlp from 'compromise'
import absolutify from 'absolutify'
import { JSDOM } from 'jsdom'
import jquery from 'jquery'
import { createRequire } from 'module'
import {
  setDefaultOptions,
  setCleanRules,
  prepDocument,
  grabArticle,
  capitalizeFirstLetter
} from './helpers.js'
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
        [...skippedResources].some(resource => requestUrl.includes(resource)) ||
        (request.isNavigationRequest() && request.redirectChain().length)
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

  if (typeof options.readability === 'undefined') {
    options.readability = {}
  }

  const dom = new JSDOM(html)

  await setCleanRules(options.readability.cleanRulers || [])
  await prepDocument(dom.window.document)

  // Derived Title & Content
  article.title.text = await getTitle(dom.window.document, options.title)
  let content = grabArticle(dom.window.document, false, options.regex).innerHTML

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

    const { window } = new JSDOM(article.processed.html)
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
/**
 * gets the best available title for the article
 *
 * @param {String} document - the html document
 *
 * @return {String} the title of the article
 *
 */

const getTitle = function (document) {
  let title = findMetaTitle(document) || document.title

  // replace all 3 types of line breaks with a space
  title = title.replace(/(\r\n|\n|\r)/gm, ' ')

  // replace all double white spaces with single spaces
  title = title.replace(/\s+/g, ' ')

  return title
}

/**
 * gets the best available meta title of the article
 *
 * @param {String} document - the html document
 *
 * @return {String} the best available meta title of the article
 *
 */

const findMetaTitle = function (document) {
  const metaTags = document.getElementsByTagName('meta')
  let tag

  for (let i = 0; i < metaTags.length; i++) {
    tag = metaTags[i]

    if (tag.getAttribute('property') === 'og:title' || tag.getAttribute('name') === 'twitter:title') {
      return tag.getAttribute('content')
    }
  }
  return null
}

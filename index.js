const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

puppeteer.use(StealthPlugin())

const lighthouseImport = require('lighthouse')
const lighthouse = lighthouseImport.default || lighthouseImport
const fs = require('fs')
const retext = require('retext')
const nlcstToString = require('nlcst-to-string')
const pos = require('retext-pos')
const keywords = require('retext-keywords')
const _ = require('lodash')
const cleaner = require('clean-html')
const Sentiment = require('sentiment')
const spell = require('retext-spell')
const dictionary = require('dictionary-en-gb')
const report = require('vfile-reporter-json')
const htmlToText = require('html-to-text')
const nlp = require('compromise')
const absolutify = require('absolutify')
const jsdom = require('jsdom')
const { JSDOM } = jsdom
const helpers = require('./helpers')

/**
 * main article parser module export function
 *
 * @param {Object} options - the options object
 * @param {Object} socket - the optional socket
 *
 * @return {Object} article parser results object
 *
 */

module.exports.parseArticle = async function (options, socket) {
  if (typeof socket === 'undefined') {
    socket = { emit: function (type, status) { console.log(status) } }
  }

  options = helpers.setDefaultOptions(options)

  // Allow nlp plugins to be passed in (https://observablehq.com/@spencermountain/compromise-plugins)
  if (options.nlp.plugins.length >= 1) {
    for (const plugin of options.nlp.plugins) {
      nlp.extend(plugin)
    }
  }

  const actions = [articleParser(options, socket)]

  if (options.enabled.includes('lighthouse')) {
    actions.push(lighthouseAnalysis(options, socket))
  }

  const results = await Promise.all(actions)

  const article = results[0]

  article.lighthouse = results[1]

  return article
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

const articleParser = async function (options, socket) {
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

  // Init puppeteer
  const browser = await puppeteer.launch(options.puppeteer.launch)

  const page = await browser.newPage()

  // Ignore content security policies
  await page.setBypassCSP(options.puppeteer.setBypassCSP)

  await page.setRequestInterception(true)

  page.on('request', request => {
    const requestUrl = request.url().split('?')[0].split('#')[0]
    if (
      options.blockedResourceTypes.indexOf(request.resourceType()) !== -1 ||
      options.skippedResources.some(resource => requestUrl.indexOf(resource) !== -1) ||
      (request.isNavigationRequest() && request.redirectChain().length)
    ) {
      request.abort()
    } else {
      request.continue()
    }
  })

  // Inject jQuery from local package to avoid external network fetch
  const jquery = await fs.promises.readFile(require.resolve('jquery/dist/jquery.min.js'), 'utf8')

  let response
  try {
    response = await page.goto(options.url, options.puppeteer.goto)
  } catch (e) {
    const message = 'Failed to fetch ' + options.url + ': ' + e.message
    socket.emit('parse:status', message)
    await browser.close()
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

  await page.evaluate(jquery)

  socket.emit('parse:status', 'Fetching ' + options.url)

  // Evaluate status
  article.status = response.request().response().status()

  socket.emit('parse:status', 'Status ' + article.status)

  if (article.status === 403 || article.status === 404) {
    const message = 'Failed to fetch ' + options.url + ' ' + article.status
    socket.emit('parse:status', message)
    await browser.close()
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
      var j = window.$
      return j('link[rel~="icon"]').prop('href')
    })
  }

  // Evaluate meta
  socket.emit('parse:status', 'Evaluating Meta Data')

  const meta = await page.evaluate(() => {
    var j = window.$

    var arr = j('meta')
    var meta = {}
    var i = 0

    for (i = 0; i < arr.length; i++) {
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
    var j = window.$
    return j('html').html()
  })

  // HTML Cleaning
  let html = await page.evaluate((options) => {
    var j = window.$

    for (var i = 0; i < options.length; i++) {
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

  await helpers.setCleanRules(options.readability.cleanRulers || [])
  await helpers.prepDocument(dom.window.document)

  // Derived Title & Content
  article.title.text = await getTitle(dom.window.document, options.title)
  let content = helpers.grabArticle(dom.window.document, false, options.regex).innerHTML

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

  browser.close()

  // Turn relative links into absolute links & assign processed html
  article.processed.html = await absolutify(content, article.baseurl)

  // Get in article links
  if (options.enabled.includes('links')) {
    socket.emit('parse:status', 'Evaluating Links')

    const { window } = new JSDOM(article.processed.html)
    const $ = require('jquery')(window)

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
  article.excerpt = helpers.capitalizeFirstLetter(article.processed.text.raw.replace(/^(.{200}[^\s]*).*/, '$1'))

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
}

/**
 * checks the spelling of the article
 *
 * @param {String} text - the string of text to run the spellcheck against
 * @param {Object} options - [retext-spell options]{@link https://github.com/retextjs/retext-spell}
 * @param {Array} options.dictionary - by default is set to [en-gb]{@link https://github.com/wooorm/dictionaries/tree/master/dictionaries/en-GB}.
 *
 * @return {Object} object containing potentially misspelled words
 *
 */

const spellCheck = function (text, options) {
  text = text.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, '')

  return new Promise(function (resolve, reject) {
    if (typeof options === 'undefined') {
      options = {
        dictionary: dictionary
      }
    }

    if (typeof options.dictionary === 'undefined') {
      options.dictionary = dictionary
    }

    retext()
      .use(spell, options)
      .process(text, function (error, file) {
        if (error) {
          reject(error)
        }

        let results = JSON.parse(report(file))
        results = results[0].messages
        resolve(results)
      })
  })
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
  return new Promise(function (resolve, reject) {
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
    let rawText = htmlToText.fromString(html, options)

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
  return new Promise(function (resolve, reject) {
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
    const text = htmlToText.fromString(html, options)

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
  return new Promise(function (resolve, reject) {
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
  return new Promise(function (resolve, reject) {
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
 * takes a string of html and runs it through [retext-keywords]{@link https://github.com/retextjs/retext-keywords} and returns keyword and keyphrase suggestions
 *
 * @param {String} html - the html to process
 * @param {Object} options - the [retext-keywords options]{@link https://github.com/retextjs/retext-keywords#api}
 *
 * @return {Object} the keyword and keyphrase suggestions
 *
 */

const keywordParser = function (html, options) {
  return new Promise(function (resolve, reject) {
    if (typeof options === 'undefined') {
      options = { maximum: 10 }
    }

    retext()
      .use(pos)
      .use(keywords, options)
      .process(html, function (error, file) {
        if (error) {
          reject(error)
        }

        const keywords = []
        const keyphrases = []

        file.data.keywords.forEach(function (keyword) {
          keywords.push({
            keyword: nlcstToString(keyword.matches[0].node),
            score: keyword.score
          })
        })

        file.data.keyphrases.forEach(function (phrase) {
          const nodes = phrase.matches[0].nodes
          const tree = _.map(nodes)

          keyphrases.push({
            keyphrase: nlcstToString(tree, ''),
            score: phrase.score,
            weight: phrase.weight
          })
        })

        keyphrases.sort(function (a, b) {
          return (a.score > b.score) ? -1 : 1
        })

        resolve({ keywords: keywords, keyphrases: keyphrases })
      }
      )
      .catch(function (error) {
        reject(error)
      })
  })
}

/**
 * runs a google lighthouse audit on the target article
 *
 * @param {Object} options - the article parser options object
  * @param {Object} options.puppeteer.launch - the pupperteer launch options
 *
 * @return {Object} the google lighthouse analysis
 *
 */

const lighthouseAnalysis = async function (options, socket) {
  socket.emit('parse:status', 'Starting Lighthouse')

  // Init puppeteer
  const browser = await puppeteer.launch(options.puppeteer.launch)

  const results = await lighthouse(options.url, {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json'
  })

  browser.close()

  socket.emit('parse:status', 'Lighthouse Analysis Complete')

  return results.lhr
}

/**
 * gets the best available title for the article
 *
 * @param {String} document - the html document
 *
 * @return {String} the title of the article
 *
 */

const getTitle = function (document, options) {
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

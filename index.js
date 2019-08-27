const puppeteer = require('puppeteer')
const lighthouse = require('lighthouse')
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
const personalDictionary = require('./personalDictionary.js')
const htmlTags = require('./stripTags.js')
const jsdom = require('jsdom')
const { JSDOM } = jsdom
const helpers = require('./helpers')

module.exports = {
  parseArticle: async function (options, socket) {
    let article = {}

    if (typeof socket === 'undefined') {
      socket = { emit: function (type, status) { console.log(status) } }
    }

    if (typeof options.enabled === 'undefined') {
      options.enabled = []
    }

    if (typeof options.puppeteer === 'undefined') {
      options.puppeteer = {
        headless: true,
        defaultViewport: null
      }
    }

    const actions = [articleParser(options, socket)]

    if (options.enabled.includes('lighthouse')) {
      actions.push(lighthouseAnalysis(options, socket))
    }

    const results = await Promise.all(actions)

    article = results[0]
    article.lighthouse = results[1]

    return article
  }
}

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

  if (typeof options.striptags === 'undefined') {
    options.striptags = htmlTags
  }

  socket.emit('parse:status', 'Starting Horseman')

  // Init puppeteer
  const browser = await puppeteer.launch(options.puppeteer)

  const page = await browser.newPage()

  const response = await page.goto(options.url)

  socket.emit('parse:status', 'Fetching ' + options.url)

  // Evaluate status
  article.status = response.request().response().status()

  socket.emit('parse:status', 'Status ' + article.status)

  if (article.status === 403 || article.status === 404) {
    await browser.close()
    return article.status + ' Failed to fetch URL'
  }

  // Evaluate URL
  article.url = response.request().response().url()

  const pathArray = article.url.split('/')
  const protocol = pathArray[0]
  const host = pathArray[2]

  article.baseurl = protocol + '//' + host

  // Evaluate title
  article.meta.title.text = await page.title()

  // Take mobile screenshot
  if (options.enabled.includes('screenshot')) {
    socket.emit('parse:status', 'Taking Mobile Screenshot')

    article.mobile = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 })
  }

  // Evaluate meta
  await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' })

  socket.emit('parse:status', 'Evaluating Meta Data')

  const meta = await page.evaluate(() => {
    const j = window.$

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

  // HTML Cleaning
  let html = await page.evaluate((options) => {
    const j = window.$

    for (var i = 0; i < options.length; i++) {
      j(options[i]).remove()
    }

    return j('html').html()
  }, options.striptags)

  // More HTML Cleaning
  html = await htmlCleaner(html, options.cleanhtml)

  // Body Content Identification
  socket.emit('parse:status', 'Evaluating Content')

  const content = await contentParser(html, options.readability)

  // Turn relative links into absolute links
  article.processed.html = await absolutify(content.content, article.baseurl)
  article.title.text = content.title

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
  article.processed.text.raw = await getRawText(article.processed.html, article.title.text)

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
    article.people = nlp(article.processed.text.raw).people().out('topk')

    article.people.sort(function (a, b) {
      return (a.percent > b.percent) ? -1 : 1
    })

    // Places
    article.places = nlp(article.processed.text.raw).places().out('topk')

    article.places.sort(function (a, b) {
      return (a.percent > b.percent) ? -1 : 1
    })

    // Orgs & Places
    article.orgs = nlp(article.processed.text.raw).organizations().out('topk')

    article.orgs.sort(function (a, b) {
      return (a.percent > b.percent) ? -1 : 1
    })

    // Topics
    article.topics = nlp(article.processed.text.raw).topics().out('topk')

    article.topics.sort(function (a, b) {
      return (a.percent > b.percent) ? -1 : 1
    })
  }

  // Spelling
  if (options.enabled.includes('spelling')) {
    socket.emit('parse:status', 'Check Spelling')

    article.spelling = await spellCheck(article.processed.text.formatted, article.topics, options.retextspell)
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

  await browser.close()

  socket.emit('parse:status', 'Horseman Anaysis Complete')

  return article
}

const spellCheck = function (text, topics, options) {
  text = text.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, '')

  return new Promise(function (resolve, reject) {
    let ignoreList = _.map(topics, 'normal')
    ignoreList = ignoreList.join(' ')
    ignoreList = helpers.toTitleCase(ignoreList) + ' ' + ignoreList.toUpperCase()
    ignoreList = ignoreList.split(' ')

    if (typeof options === 'undefined') {
      options = {
        dictionary: dictionary,
        personal: personalDictionary,
        ignore: ignoreList
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

const getRawText = function (html, title, options) {
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
    rawText = nlp(title + '\n\n' + rawText)
    rawText.normalize()
    rawText = rawText.out('text')

    resolve(rawText)
  })
}

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

const contentParser = async function (html, options) {
  if (typeof options === 'undefined') {
    options = {}
  }

  const dom = new JSDOM(html)

  await helpers.setCleanRules(options.cleanRulers || [])
  await helpers.prepDocument(dom.window.document)

  const content = await getContent(dom.window.document)
  const title = await getTitle(dom.window.document)

  return ({ title: title, content: content })
}

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

const lighthouseAnalysis = async function (options, socket) {
  socket.emit('parse:status', 'Starting Lighthouse')

  // Init puppeteer
  const browser = await puppeteer.launch(options.puppeteer)

  const results = await lighthouse(options.url, {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json'
  })

  await browser.close()

  socket.emit('parse:status', 'Lighthouse Analysis Complete')

  return results.lhr
}

const getContent = function (document) {
  var articleContent = helpers.grabArticle(document)

  return articleContent.innerHTML
}

const getTitle = function (document) {
  var title = findMetaTitle(document) || document.title
  var betterTitle
  var commonSeparatingCharacters = [' | ', ' _ ', ' - ', '«', '»', '—']

  commonSeparatingCharacters.forEach(function (char) {
    var tmpArray = title.split(char)
    if (tmpArray.length > 1) {
      betterTitle = tmpArray[0].trim()
    }
  })

  if (betterTitle && betterTitle.length > 10) {
    return betterTitle
  }

  return title
}

const findMetaTitle = function (document) {
  var metaTags = document.getElementsByTagName('meta')
  var tag

  for (var i = 0; i < metaTags.length; i++) {
    tag = metaTags[i]

    if (tag.getAttribute('property') === 'og:title' || tag.getAttribute('name') === 'twitter:title') {
      return tag.getAttribute('content')
    }
  }
  return null
}

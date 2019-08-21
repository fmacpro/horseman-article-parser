const phantomjs = require('phantomjs-prebuilt')
const Horseman = require('node-horseman')
const read = require('node-readability')
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
const lighthouse = require('lighthouse')
const chromeLauncher = require('chrome-launcher')
const jsdom = require('jsdom')
const { JSDOM } = jsdom

function launchChromeAndRunLighthouse (url, opts, config = null) {
  return chromeLauncher.launch({ chromeFlags: opts.chromeFlags }).then(chrome => {
    opts.port = chrome.port
    return lighthouse(url, opts, config).then(results => {
      // use results.lhr for the JS-consumeable output
      // https://github.com/GoogleChrome/lighthouse/blob/master/types/lhr.d.ts
      // use results.report for the HTML/JSON/CSV output as a string
      // use results.artifacts for the trace/screenshots/other specific case you need (rarer)
      return chrome.kill().then(() => results.lhr)
    })
  })
}

function capitalizeFirstLetter (string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

function toTitleCase (str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  })
}

module.exports = {
  parseArticle: function (options, socket) {
    if (typeof socket === 'undefined') {
      socket = { emit: function (type, status) { console.log(status) } }
    }

    return run(options, socket)
  }
}

const run = function (options, socket) {
  return new Promise(function (resolve, reject) {
    const article = {}

    Promise.all([articleParser(options, socket), lighthouseAnalysis(options.url, options.lighthouse, socket)]).then(function (results) {
      Object.assign(article, results[0])
      Object.assign(article.lighthouse, results[1])
      resolve(article)
    })
  })
}

const articleParser = function (options, socket) {
  const article = {}
  article.meta = {}
  article.meta.title = {}
  article.links = []
  article.title = {}
  article.excerpt = ''
  article.processed = {}
  article.processed.text = {}
  article.lighthouse = {}

  if (typeof options.horseman === 'undefined') {
    options.horseman = {
      timeout: 10000,
      cookies: './cookies.json'
    }
  }

  if (typeof options.horseman.phantomPath === 'undefined') {
    options.horseman.phantomPath = phantomjs.path
  }

  if (typeof options.userAgent === 'undefined') {
    options.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36'
  }

  if (typeof options.striptags === 'undefined') {
    options.striptags = htmlTags
  }

  return new Promise(function (resolve, reject) {
    const horseman = new Horseman(options.horseman)

    socket.emit('parse:status', 'Starting Horseman')

    // Init horseman
    horseman
      .userAgent(options.userAgent)
      .viewport(540, 800)
      .open(options.url)
      .then(socket.emit('parse:status', 'Fetch ' + options.url))

      // Evaluate status
      .status()
      .then(function (status) {
        article.status = status
        socket.emit('parse:status', 'Status ' + status)
        if (status === 403 || status === 404) {
          reject(status)
          return horseman.close()
        }
      })

      // Evaluate URL
      .url()
      .then(function (url) {
        article.url = url

        const pathArray = article.url.split('/')
        const protocol = pathArray[0]
        const host = pathArray[2]

        article.baseurl = protocol + '//' + host
      })
      .waitForSelector('head')

      // Evaluate title
      .title()
      .then(function (title) {
        article.meta.title.text = title
      })
      // Take mobile screenshot
      .then(function () {
        socket.emit('parse:status', 'Taking Mobile Screenshot')
      })
      .screenshotBase64('JPEG')
      .then(function (screenshot) {
        article.mobile = screenshot
      })

      // Evaluate meta
      .then(function () {
        socket.emit('parse:status', 'Evaluating Meta Data')
      })
      .evaluate(function () {
        var j = jQuery.noConflict()
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
      .then(function (meta) {
        Object.assign(article.meta, meta)
        // Assign description
        const metaDescription = article.meta.description
        article.meta.description = {}
        article.meta.description.text = metaDescription
      })

      // HTML Cleaning
      .evaluate(function (options) {
        var j = jQuery.noConflict()
        for (var i = 0; i < options.length; i++) {
          j(options[i]).remove()
        }
      }, options.striptags)
      .html('html')

      // More HTML Cleaning
      .then(function (html) {
        return htmlCleaner(html, options.cleanhtml)
      })

      // Body Content Identification
      .then(function (html) {
        socket.emit('parse:status', 'Evaluating Content')
        return contentParser(html, options.readability)
      })
      .then(function (content) {
        // Turn relative links into absolute links
        article.processed.html = absolutify(content.content, article.baseurl)
        article.title.text = content.title

        // Get in article links
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
        return links
      })
      .then(function (links) {
        Object.assign(article.links, links)
      })
      // Formatted Text (including new lines and spacing for spell check)
      .then(function () {
        return getFormattedText(article.processed.html, article.title.text, article.baseurl, options.htmltotext)
      })
      .then(function (formattedText) {
        article.processed.text.formatted = formattedText
      })

      // HTML Text (spans on each line for spell check line numbers)
      .then(function () {
        return getHtmlText(article.processed.text.formatted)
      })
      .then(function (htmlText) {
        article.processed.text.html = htmlText
      })

      // Raw Text (text prepared for keyword analysis & named entity recongnition)
      .then(function () {
        return getRawText(article.processed.html, article.title.text)
      })
      .then(function (rawText) {
        article.processed.text.raw = rawText
      })

      // Excerpt
      .then(function () {
        article.excerpt = capitalizeFirstLetter(article.processed.text.raw.replace(/^(.{200}[^\s]*).*/, '$1'))
      })

      // Sentiment
      .then(function () {
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
      })

      // Named Entity Recognition
      .then(function () {
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
      })

      // Spelling
      .then(function () {
        socket.emit('parse:status', 'Check Spelling')
        return spellCheck(article.processed.text.formatted, article.topics, options.retextspell)
      })
      .then(function (data) {
        article.spelling = data
      })

      // Evaluate keywords & keyphrases
      .then(function () {
        socket.emit('parse:status', 'Evaluating Keywords')
      })

      // Evaluate meta title keywords & keyphrases
      .then(function () {
        return keywordParser(article.meta.title.text, options.retextkeywords)
      })
      .then(function (keywords) {
        Object.assign(article.meta.title, keywords)
      })

      // Evaluate derived title keywords & keyphrases
      .then(function () {
        return keywordParser(article.title.text, options.retextkeywords)
      })
      .then(function (keywords) {
        Object.assign(article.title, keywords)
      })

      // Evaluate meta description keywords & keyphrases
      .then(function () {
        return keywordParser(article.meta.description.text, options.retextkeywords)
      })
      .then(function (keywords) {
        Object.assign(article.meta.description, keywords)
      })

      // Evaluate processed content keywords & keyphrases
      .then(function () {
        return keywordParser(article.processed.text.raw, options.retextkeywords)
      })
      .then(function (keywords) {
        Object.assign(article.processed, keywords)
      })
      .then(function () {
        socket.emit('parse:status', 'Horseman Anaysis Complete')
        resolve(article)
      })
      .close()

      // Catch and emit errors
      .catch(function (error) {
        reject(error)
      })
  })
}

const spellCheck = function (text, topics, options) {
  text = text.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, '')

  return new Promise(function (resolve, reject) {
    let ignoreList = _.map(topics, 'normal')
    ignoreList = ignoreList.join(' ')
    ignoreList = toTitleCase(ignoreList) + ' ' + ignoreList.toUpperCase()
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

const contentParser = function (html, options) {
  return new Promise(function (resolve, reject) {
    // https://github.com/luin/readability

    if (typeof options === 'undefined') {
      options = {}
    }

    read(html, options, function (error, article, meta) {
      if (error) {
        article.close()
        reject(error)
      }

      const title = article.title
      const content = article.content

      article.close()

      resolve({ title: title, content: content })
    })
  })
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

const lighthouseAnalysis = function (url, options, socket) {
  return new Promise(function (resolve, reject) {
    if (typeof options === 'undefined') {
      options = {
        chromeFlags: ['--headless'],
        enabled: false
      }
    }

    if (options.enabled) {
      socket.emit('parse:status', 'Starting Lighthouse')

      if (typeof options.chromeFlags === 'undefined') {
        options.chromeFlags = ['--headless']
      }

      launchChromeAndRunLighthouse(url, options).then(results => {
        socket.emit('parse:status', 'Lighthouse Analysis Complete')

        resolve(results)
      })
    }
  })
}

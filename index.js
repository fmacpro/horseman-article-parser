const puppeteer = require('puppeteer');
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
    //options.horseman.phantomPath = phantomjs.path
  }

  if (typeof options.userAgent === 'undefined') {
    options.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36'
  }

  if (typeof options.striptags === 'undefined') {
    options.striptags = htmlTags
  }

  return new Promise(function (resolve, reject) {

    (async () => {

      // Init puppeteer
      const browser = await puppeteer.launch();
      
      const page = await browser.newPage();

      const response = await page.goto(options.url)
      
      socket.emit('parse:status', 'Fetch ' + options.url)

      // Evaluate status
      article.status = response.request().response().status()
      
      socket.emit('parse:status', 'Status ' + article.status)

      if (article.status === 403 || article.status === 404) {
          reject(article.status)
          await browser.close();
      }

      // Evaluate URL
      article.url = response.request().response().url()

      const pathArray = article.url.split('/')
      const protocol = pathArray[0]
      const host = pathArray[2]

      article.baseurl = protocol + '//' + host

      console.log(article.baseurl);

      // Evaluate title
      article.meta.title.text = await page.title();

      console.log(article.meta.title.text);

      // Take mobile screenshot
      article.mobile = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });

      console.log(article.mobile);

      // Evaluate meta


      await browser.close();

    })();

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

var phantomjs = require('phantomjs-prebuilt')
var Horseman = require('node-horseman')
var read = require('node-readability')
var retext = require('retext')
var nlcstToString = require('nlcst-to-string')
var keywords = require('retext-keywords')
var _ = require('lodash')
var cleaner = require('clean-html')
var Sentiment = require('sentiment')
var spell = require('retext-spell')
var dictionary = require('dictionary-en-gb')
var report = require('vfile-reporter-json')
var htmlToText = require('html-to-text')
var nlp = require('compromise')
var personalDictionary = require('./personal.js')

module.exports = {
  parseArticle: function (options, socket) {
    if (typeof socket === 'undefined') {
      socket = { emit: function (type, status) { console.log(status) } }
    }

    return articleParser(options, socket)
  }
}

var articleParser = function (options, socket) {
  var article = {}
  article.meta = {}
  article.meta.title = {}
  article.links = []
  article.title = {}
  article.processed = {}
  article.processed.text = {}

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
    options.striptags = [
      "img",
      "noscript",
      "style",
      "script",
      "figure",
      ".ayl-text",
      ".affiliate-text",
      ".mol-video",
      ".mol-img-group",
      ".artSplitter",
      "#ayl-wrapper",
      "h3.sharing-bar__title",
    ]
  }

  return new Promise(function (resolve, reject) {
    var horseman = new Horseman(options.horseman)

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
        var arr = $('meta')
        var meta = {}
        var i = 0

        for (i = 0; i < arr.length; i++) {
          if ($(arr[i]).attr('name')) {
            meta[$(arr[i]).attr('name')] = $(arr[i]).attr('content')
          } else if ($(arr[i]).attr('property')) {
            meta[$(arr[i]).attr('property')] = $(arr[i]).attr('content')
          } else {
            // do nothing for now
          }
        }
        return meta
      })

      // Evaluate links
      .then(function (meta) {
        Object.assign(article.meta, meta)

        var metaDescription = article.meta.description
        article.meta.description = {}
        article.meta.description.text = metaDescription

        socket.emit('parse:status', 'Evaluating Links')
      })
      .evaluate(function () {
        var arr = $('a')
        var links = []
        var i = 0

        for (i = 0; i < arr.length; i++) {
          var link = { href: $(arr[i]).attr('href'), text: $(arr[i]).text() }
          links.push(link)
        }
        return links
      })
      .then(function (links) {
        Object.assign(article.links, links)
        socket.emit('parse:status', 'Cleaning HTML')
      })

      // HTML Cleaning
      .evaluate(function (options) {

        for (i = 0; i < options.length; i++) {
          $(options[i]).remove();
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

      // Plain Text
      .then(function (content) {
        socket.emit('parse:status', 'HTML > TEXT')

        article.processed.html = content.content
        article.title.text = content.title
        article.source = content.content

        return getPlainText(content.content, content.title, options.texttohtml)
      })
      .then(function (text) {
        article.processed.text.formatted = text.formatted
        article.processed.text.raw = text.raw
        article.processed.text.html = text.html
      })

      // Sentiment
      .then(function () {
        socket.emit('parse:status', 'Sentiment Analysis')
        var sentiment = new Sentiment()
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
        socket.emit('parse:status', 'Done')
        resolve(article)
      })
      .close()

      // Catch and emit errors
      .catch(function (error) {
        reject(error)
      })
  })
}

var spellCheck = function (text, topics, options) {
  text = text.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, '')

  function toTitleCase (str) {
    return str.replace(/\w\S*/g, function (txt) {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    })
  }

  return new Promise(function (resolve, reject) {
    var ignoreList = _.map(topics, 'normal')
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

    retext()
      .use(spell, options)
      .process(text, function (error, file) {
        if (error) {
          reject(error)
        }

        var results = JSON.parse(report(file))
        results = results[0].messages
        resolve(results)
      })
  })
}

var getPlainText = function (html, title, options) {
  return new Promise(function (resolve, reject) {
    if (typeof options === 'undefined') {
      options = {
        wordwrap: 100,
        noLinkBrackets: true,
        ignoreHref: true,
        tables: true,
        uppercaseHeadings: true
      }
    }

    // Lowercase for analysis
    var copy = {
      wordwrap: 100,
      noLinkBrackets: true,
      ignoreHref: true,
      ignoreImage: true,
      tables: true,
      uppercaseHeadings: false
    }

    // HTML > Text
    var text = htmlToText.fromString(html, options)

    // Normalised (Raw) Text (https://beta.observablehq.com/@spencermountain/compromise-normalization)
    var rawText = htmlToText.fromString(html, copy)
    rawText = nlp(title + '\n\n' + rawText)
    rawText.normalize()
    rawText = rawText.out('text')

    // If uppercase is set uppercase the title
    if (options.uppercaseHeadings === true) {
      title = title.toUpperCase()
    }

    // Formatted Text (including new lines and spacing for spell check)
    var formattedText = title + '\n\n' + text

    // HTML Text (spans on each line for spell check line numbers)
    // Replace windows line breaks with linux line breaks & split each line into array
    var textArray = formattedText.replace('\r\n', '\n').split('\n')
    // Check length of text array (no of lines)
    var codeLength = textArray.length
    // Wrap each line in a span
    textArray.forEach(function (line, index, array) {
      if (codeLength === index) return
      if (index === 0) line = line.trim()
      array[index] = '<span>' + line + '</span>'
    })
    // Join each line back into a string
    htmlText = textArray.join('\n')

    // return raw, formatted & html text
    resolve({ raw: rawText, formatted: formattedText, html: htmlText })
  })
}

var htmlCleaner = function (html, options) {
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

var contentParser = function (html, options) {
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

      var title = article.title
      var content = article.content

      article.close()

      resolve({ title: title, content: content })
    })
  })
}

var keywordParser = function (html, options) {
  return new Promise(function (resolve, reject) {
    if (typeof options === 'undefined') {
      options = { maximum: 10 }
    }

    retext().use(keywords, options).process(html,
      function (error, file) {
        if (error) {
          reject(error)
        }

        var keywords = []
        var keyphrases = []

        file.data.keywords.forEach(function (keyword) {
          keywords.push({
            keyword: nlcstToString(keyword.matches[0].node),
            score: keyword.score
          })
        })

        file.data.keyphrases.forEach(function (phrase) {
          var nodes = phrase.matches[0].nodes
          var tree = _.map(nodes)

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

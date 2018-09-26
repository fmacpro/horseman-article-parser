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
  parseArticle: function (config, socket) {
    if (typeof socket === 'undefined') {
      socket = { emit: function (type, status) { console.log(status) } }
    }

    return articleParser(config, socket)
  }
}

var articleParser = function (config, socket) {
  var article = {}
  article.meta = {}
  article.meta.title = {}
  article.links = []
  article.title = {}
  article.processed = {}

  config.horseman.phantomPath = phantomjs.path

  return new Promise(function (resolve, reject) {
    var horseman = new Horseman(config.horseman)

    // Init horseman
    horseman
      .userAgent(config.userAgent)
      .viewport(540, 800)
      .open(config.url)
      .then(socket.emit('parse:status', 'Fetch ' + config.url))

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
      .evaluate(function (selector) {
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
      }, 'head')

      // Evaluate links
      .then(function (meta) {
        Object.assign(article.meta, meta)

        var metaDescription = article.meta.description
        article.meta.description = {}
        article.meta.description.text = metaDescription

        socket.emit('parse:status', 'Evaluating Links')
      })
      .evaluate(function (selector) {
        var arr = $('a')
        var links = []
        var i = 0

        for (i = 0; i < arr.length; i++) {
          var link = { href: $(arr[i]).attr('href'), text: $(arr[i]).text() }
          links.push(link)
        }
        return links
      }, 'body')
      .then(function (links) {
        Object.assign(article.links, links)
        socket.emit('parse:status', 'Cleaning HTML')
      })

      // HTML Cleaning
      .evaluate(function (selector) {
        $('img').remove()
        $('noscript').remove()
        $('body').find('style').remove()
        $('body').find('script').remove()

        // Evening Telegraph (dundee)
        $('body').find('#ayl-wrapper').remove()
        $('body').find('h3').remove('.sharing-bar__title')
        $('body').find('.ayl-text').remove()

        // Extreme Tech
        $('.affiliate-text').remove()

        // BBC News
        $('figure').remove()

        // Daily Mail
        $('.mol-video').remove()
        $('.mol-img-group').remove()
        $('.artSplitter').remove()
      }, 'body')
      .html('html')

      // More HTML Cleaning
      .then(function (html) {
        return htmlCleaner(html)
      })

      // Body Content Identification
      .then(function (html) {
        socket.emit('parse:status', 'Evaluating Content')
        return contentParser(html)
      })

      // Plain Text
      .then(function (content) {
        socket.emit('parse:status', 'HTML > TEXT')

        article.processed.html = content.content
        article.title.text = content.title
        article.source = content.content

        return getPlainText(content.content)
      })
      .then(function (data) {
        // Proccessed Text (including new lines and spacing for spell check)
        article.processed.text = article.title.text + '\n\n' + data.text
        // Normalised Text (https://beta.observablehq.com/@spencermountain/compromise-normalization)
        var text = nlp(article.title.text + '\n\n' + data.text)
        text.normalize()
        article.processed.normalisedText = text.out('text')
        // Formatted Text (spans on each line for spell check line numbers)
        article.processed.formattedText = '<span>' + article.title.text.toUpperCase() + '</span>\n<span></span>\n' + data.formattedText
      })

      // Sentiment
      .then(function () {
        socket.emit('parse:status', 'Sentiment Analysis')
        var sentiment = new Sentiment()
        article.sentiment = sentiment.analyze(article.processed.normalisedText)
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
        article.people = nlp(article.processed.normalisedText).people().out('topk')

        article.people.sort(function (a, b) {
          return (a.percent > b.percent) ? -1 : 1
        })

        // Places
        article.places = nlp(article.processed.normalisedText).places().out('topk')

        article.places.sort(function (a, b) {
          return (a.percent > b.percent) ? -1 : 1
        })

        // Orgs & Places
        article.orgs = nlp(article.processed.normalisedText).organizations().out('topk')

        article.orgs.sort(function (a, b) {
          return (a.percent > b.percent) ? -1 : 1
        })

        // Topics
        article.topics = nlp(article.processed.normalisedText).topics().out('topk')

        article.topics.sort(function (a, b) {
          return (a.percent > b.percent) ? -1 : 1
        })
      })

      // Spelling
      .then(function () {
        socket.emit('parse:status', 'Check Spelling')
        return spellCheck(article.processed.text, article.topics)
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
        return keywordParser(article.meta.title.text)
      })
      .then(function (keywords) {
        Object.assign(article.meta.title, keywords)
      })

      // Evaluate derived title keywords & keyphrases
      .then(function () {
        return keywordParser(article.title.text)
      })
      .then(function (keywords) {
        Object.assign(article.title, keywords)
      })

      // Evaluate meta description keywords & keyphrases
      .then(function () {
        return keywordParser(article.meta.description.text)
      })
      .then(function (keywords) {
        Object.assign(article.meta.description, keywords)
      })

      // Evaluate processed content keywords & keyphrases
      .then(function () {
        return keywordParser(article.processed.normalisedText)
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

var spellCheck = function (text, topics) {
  text = text.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, '')

  function toTitleCase (str) {
    return str.replace(/\w\S*/g, function (txt) {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    })
  }

  return new Promise(function (resolve, reject) {
    var ignoreList = _.map(topics, 'normal')
    ignoreList = ignoreList.join(' ')
    ignoreList = toTitleCase(ignoreList)
    ignoreList = ignoreList.split(' ')

    retext()
      .use(spell, {
        dictionary: dictionary,
        personal: personalDictionary,
        ignore: ignoreList
      })
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

var getPlainText = function (html) {
  return new Promise(function (resolve, reject) {
    // HTML > Text
    var text = htmlToText.fromString(html, {
      wordwrap: 100,
      noLinkBrackets: true,
      ignoreHref: true,
      tables: true,
      uppercaseHeadings: false
    })

    // HTML > Text
    var formattedText = htmlToText.fromString(html, {
      wordwrap: 100,
      noLinkBrackets: true,
      ignoreHref: true,
      tables: true
    })

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
    formattedText = textArray.join('\n')

    // return both raw & formatted text
    resolve({ text: text, formattedText: formattedText })
  })
}

var htmlCleaner = function (html) {
  return new Promise(function (resolve, reject) {
    var options = {
      'add-remove-tags': ['blockquote', 'span'],
      'remove-empty-tags': ['span'],
      'replace-nbsp': true
    }

    cleaner.clean(html, options, function (html) {
      resolve(html)
    })
  })
}

var contentParser = function (html) {
  return new Promise(function (resolve, reject) {
    // https://github.com/luin/readability
    read(html, function (error, article, meta) {
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

var keywordParser = function (html) {
  return new Promise(function (resolve, reject) {
    retext().use(keywords, { maximum: 10 }).process(html,
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

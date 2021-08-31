const parser = require('./index.js')
const fs = require('fs')

/** add some names | https://observablehq.com/@spencermountain/compromise-plugins */
const testPlugin = function (Doc, world) {
  world.addWords({
    rishi: 'FirstName',
    sunak: 'LastName'
  })
}

const options = {
  url: 'https://www.theguardian.com/commentisfree/2021/jan/07/what-happened-in-washington-dc-is-happening-around-the-world',
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords', 'siteicon'],
  nlp: {
    plugins: [testPlugin]
  }
}

parser.parseArticle(options)
  .then(function (article) {
    const response = {
      title: article.title.text,
      excerpt: article.excerpt,
      metadescription: article.meta.description.text,
      url: article.url,
      siteicon: article.siteicon,
      sentiment: { score: article.sentiment.score, comparative: article.sentiment.comparative },
      keyphrases: article.processed.keyphrases,
      keywords: article.processed.keywords,
      people: article.people,
      orgs: article.orgs,
      places: article.places,
      text: {
        raw: article.processed.text.raw,
        formatted: article.processed.text.formatted,
        html: article.processed.text.html
      },
      spelling: article.spelling,
      meta: article.meta,
      links: article.links,
      lighthouse: article.lighthouse,
      html: article.html
    }

    const json = JSON.stringify(response, null, 4)
    fs.writeFile('testresults.json', json, 'utf8', function (err) {
      if (err) throw err
      console.log('Results written to testresults.json')
    })
  })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack)
  })

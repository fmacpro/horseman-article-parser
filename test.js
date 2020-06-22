const parser = require('./index.js')
const fs = require('fs')

const options = {
  url: 'https://www.theguardian.com/world/2020/jun/22/boris-johnson-theres-may-ignored-claims-russia-had-likely-hold-over-donald-trump-ex-spy-christopher-steele-claims',
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords']
  // enabled: ['links', 'sentiment', 'entities', 'spelling', 'keywords']
}

parser.parseArticle(options)
  .then(function (article) {
    const response = {
      title: article.title.text,
      excerpt: article.excerpt,
      metadescription: article.meta.description.text,
      url: article.url,
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
      lighthouse: article.lighthouse
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

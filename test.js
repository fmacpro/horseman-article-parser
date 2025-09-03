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
  url: 'https://www.theguardian.com/business/2025/sep/02/uk-hit-by-fresh-sell-off-in-government-bond-markets-as-pound-weakens',
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords', 'siteicon'],
  rules: [
    {
      host: 'www.bbc.co.uk',
      content: () => {
        var j = window.$
        j('article section, article figure, article header').remove()
        return j('article').html()
      }
    },
    {
      host: 'www.youtube.com',
      title: () => {
        return window.ytInitialData.contents.twoColumnWatchNextResults.results.results.contents[0].videoPrimaryInfoRenderer.title.runs[0].text
      },
      content: () => {
        return window.ytInitialData.contents.twoColumnWatchNextResults.results.results.contents[1].videoSecondaryInfoRenderer.description.runs[0].text
      }
    }
  ],
  nlp: {
    plugins: [testPlugin]
  },
  puppeteer: {
    launch: {
      headless: true,
      defaultViewport: null,
      handleSIGINT: false,
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
    }
  }
}

parser.parseArticle(options)
  .then(async function (article) {
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
      await fs.promises.writeFile('testresults.json', json, 'utf8')
      console.log('Results written to testresults.json')
      return undefined
    })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack)
  })

import { parseArticle } from '../index.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import assert from 'assert'

/** add some names | https://observablehq.com/@spencermountain/compromise-plugins */
const testPlugin = function (Doc, world) {
  world.addWords({
    rishi: 'FirstName',
    sunak: 'LastName'
  })
}

const options = {
  url: 'https://www.bbc.co.uk/news/articles/cnvryg271ymo?at_medium=RSS&at_campaign=rss',
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords', 'siteicon'],
  // Tune content detection thresholds and dump candidate features for training
  contentDetection: {
    minLength: 400,
    maxLinkDensity: 0.5,
    debugDump: {
      path: 'candidates_with_url.csv',
      topN: 5,
      addUrl: true
    }
  },
  // Exercise spelling tweaks: include end positions and offsets
  retextspell: {
    tweaks: {
      ignoreUrlLike: true,
      includeEndPosition: true,
      includeOffsets: true
    }
  },
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
    },
    // Optional: pass user agent and headers for sites that gate content
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  }
}

// Optionally load reranker weights from weights.json
try {
  if (fs.existsSync('weights.json')) {
    const weights = JSON.parse(fs.readFileSync('weights.json', 'utf8'))
    options.contentDetection = options.contentDetection || {}
    options.contentDetection.reranker = { enabled: true, weights }
  }
} catch {
  // no weights.json provided
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

;(async () => {
  try {
    const article = await parseArticle(options)
    assert.ok(article.title.text, 'article title missing')

    const response = {
      title: article.title.text,
      bodySelector: article.bodySelector,
      bodyXPath: article.bodyXPath,
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
    const outPath = path.join(__dirname, 'testresults.json')
    await fs.promises.writeFile(outPath, json, 'utf8')
    console.log('Results written to', outPath)
  } catch (error) {
    console.error(error.message)
    console.error(error.stack)
    throw error
  }
})()


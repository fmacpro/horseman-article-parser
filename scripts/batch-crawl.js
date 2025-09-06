import fs from 'fs'
import path from 'path'
import { parseArticle } from '../index.js'
import blockedResourceTypes from '../scripts/inc/blockResourceTypes.js'
import skippedResources from '../scripts/inc/skipResources.js'

function readUrls(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`URLs file not found: ${filePath}`)
  const text = fs.readFileSync(filePath, 'utf8')
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

async function run(urlsFile, outCsv = 'candidates_with_url.csv', start = 0, limit = null) {
  const all = readUrls(urlsFile)
  const end = limit ? Math.min(all.length, start + Number(limit)) : all.length
  const urls = all.slice(Number(start) || 0, end)
  console.log(`Crawling ${urls.length} URLs (slice ${start}-${end - 1}), dumping candidates to ${outCsv}`)

  for (const url of urls) {
    const options = {
      url,
      enabled: ['links'],
      blockedResourceTypes: blockedResourceTypes,
      skippedResources: skippedResources,
      contentDetection: {
        minLength: 400,
        maxLinkDensity: 0.5,
        debugDump: { path: outCsv, topN: 5, addUrl: true }
      },
      puppeteer: {
        launch: {
          headless: true,
          defaultViewport: null,
          handleSIGINT: false,
          ignoreHTTPSErrors: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--ignore-certificate-errors',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-position=0,0'
          ]
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
      }
    }

    try {
      console.log(`Fetching: ${url}`)
      await parseArticle(options)
    } catch (err) {
      console.error(`Error processing ${url}: ${err.message}`)
    }
  }
}

const urlsFile = process.argv[2] || path.resolve('urls.txt')
const outCsv = process.argv[3] || 'candidates_with_url.csv'
const start = process.argv[4] || 0
const limit = process.argv[5] || null
run(urlsFile, outCsv, start, limit).catch(err => { console.error(err); throw err })

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { extractStructuredData } from '../controllers/structuredData.js'

test('extractStructuredData reads headline and body from JSON-LD', () => {
  const script = `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Hello","articleBody":"World"}</script>`
  const { window } = new JSDOM(`<html><body>${script}</body></html>`)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, 'Hello')
  assert.equal(res.articleBody, 'World')
})

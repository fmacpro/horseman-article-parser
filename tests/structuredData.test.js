import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import { extractStructuredData } from '../controllers/structuredData.js'

test('extractStructuredData reads headline and body from JSON-LD', () => {
  const script = `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Hello","articleBody":"World"}</script>`
  const { window } = new JSDOM(`<html><body>${script}</body></html>`)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, 'Hello')
  assert.equal(res.articleBody, 'World')
})

test('extractStructuredData ignores microdata', () => {
  const html = fs.readFileSync('tests/fixtures/structured-data/microdata.html', 'utf8')
  const { window } = new JSDOM(html)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, null)
  assert.equal(res.articleBody, null)
})

test('extractStructuredData merges multiple JSON-LD blocks', () => {
  const html = fs.readFileSync('tests/fixtures/structured-data/multi-jsonld.html', 'utf8')
  const { window } = new JSDOM(html)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, 'Block Headline')
  assert.equal(res.articleBody, 'Block Body')
})

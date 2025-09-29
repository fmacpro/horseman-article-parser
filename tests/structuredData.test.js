import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import { extractStructuredData, extractBodyStructuredData } from '../controllers/structuredData.js'

const readFixture = (name) => fs.readFileSync(`tests/fixtures/structured-data/${name}`, 'utf8')

test('extractStructuredData reads headline and body from JSON-LD', () => {
  const script = `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Hello","articleBody":"World"}</script>`
  const { window } = new JSDOM(`<html><body>${script}</body></html>`)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, 'Hello')
  assert.equal(res.articleBody, 'World')
  assert.ok(Array.isArray(res.articles))
  assert.equal(res.articles.length, 1)
  assert.equal(res.articles[0].headline, 'Hello')
  assert.ok(Array.isArray(res.body.tables))
  assert.ok(Array.isArray(res.body.definitionLists))
  assert.ok(Array.isArray(res.body.figures))
})

test('extractStructuredData ignores microdata', () => {
  const html = readFixture('microdata.html')
  const { window } = new JSDOM(html)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, null)
  assert.equal(res.articleBody, null)
  assert.ok(Array.isArray(res.articles))
  assert.equal(res.articles.length, 0)
  assert.ok(Array.isArray(res.body.tables))
  assert.equal(res.body.tables.length, 0)
})

test('extractStructuredData merges multiple JSON-LD blocks', () => {
  const html = readFixture('multi-jsonld.html')
  const { window } = new JSDOM(html)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, 'Block Headline')
  assert.equal(res.articleBody, 'Block Body')
  assert.ok(Array.isArray(res.articles))
  assert.equal(res.articles.length, 2)
  assert.equal(res.articles[0]['@type'], 'NewsArticle')
  assert.equal(res.articles[1]['@type'], 'NewsArticle')
})

test('extractStructuredData finds nested article nodes', () => {
  const script = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","mainEntity":{"@type":"NewsArticle","headline":"Nested","articleBody":"Nested body"}}</script>`
  const { window } = new JSDOM(`<html><body>${script}</body></html>`)
  const res = extractStructuredData(window.document)
  assert.equal(res.headline, 'Nested')
  assert.equal(res.articleBody, 'Nested body')
  assert.ok(Array.isArray(res.articles))
  assert.equal(res.articles.length, 1)
  assert.equal(res.articles[0].headline, 'Nested')
})

test('extractBodyStructuredData returns structured tables', () => {
  const html = `<article><table><caption>GDP table</caption><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>GDP</td><td>$1</td></tr><tr><td>Inflation</td><td>2%</td></tr></tbody></table></article>`
  const body = extractBodyStructuredData(html)
  assert.ok(Array.isArray(body.tables))
  assert.equal(body.tables.length, 1)
  const table = body.tables[0]
  assert.equal(table.caption, 'GDP table')
  assert.deepEqual(table.headers, ['Metric', 'Value'])
  assert.equal(table.rowCount, 2)
  assert.equal(table.rows[0].object.Metric, 'GDP')
  assert.equal(table.rows[1].object.Value, '2%')
})

test('extractBodyStructuredData captures definition lists', () => {
  const html = `<dl><dt>Capital</dt><dd>Paris</dd><dd>Lyon (secondary)</dd><dt>Population</dt><dd>67M</dd></dl>`
  const body = extractBodyStructuredData(html)
  assert.equal(body.definitionLists.length, 1)
  const items = body.definitionLists[0].items
  assert.equal(items.length, 2)
  assert.deepEqual(items[0].descriptions, ['Paris', 'Lyon (secondary)'])
  assert.equal(items[1].term, 'Population')
  assert.deepEqual(items[1].descriptions, ['67M'])
})

test('extractBodyStructuredData handles tables without explicit header tags', () => {
  const html = readFixture('unc-table-doctors.html')
  const body = extractBodyStructuredData(html)
  assert.equal(body.tables.length, 1)
  const { headers, rows } = body.tables[0]
  assert.equal(headers[1], 'Height')
  assert.equal(headers[2], 'Age (yrs.)')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].cells[0].text, 'Ninth Doctor')
  assert.equal(rows[0].object.Height, `6'0"`)
})

test('extractBodyStructuredData captures figure metadata', () => {
  const html = readFixture('sample-figure.html')
  const body = extractBodyStructuredData(html)
  assert.equal(body.figures.length, 1)
  const figure = body.figures[0]
  assert.equal(figure.caption, 'Figure 1. Quarterly revenue trend for 2024.')
  assert.equal(figure.images.length, 1)
  assert.equal(figure.images[0].alt, 'Line chart showing quarterly revenue')
  assert.equal(figure.images[0].title, 'Quarterly Revenue')
})

test('extractBodyStructuredData parses UNC figures and charts article', () => {
  const html = readFixture('unc-figures-and-charts.html')
  const body = extractBodyStructuredData(html)
  assert.ok(body.tables.length >= 2)
  const doctorTable = body.tables.find(table => table.rows.some(row => row.cells.some(cell => cell.text.includes('Ninth Doctor'))))
  assert.ok(doctorTable)
  assert.equal(doctorTable.headers[1], 'Height')
  const doctorRow = doctorTable.rows.find(row => row.cells[0].text === 'Ninth Doctor')
  assert.ok(doctorRow)
  const height = (doctorRow.object && doctorRow.object.Height) || doctorRow.cells[1].text
  assert.ok(height.trim().startsWith('6'))
  assert.ok(/0/.test(height))
})

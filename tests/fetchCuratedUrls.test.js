import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { readFeedsFile, keepLikelyArticles, extractFromRSS, extractFromSitemap, makeBar } from '../scripts/fetch-curated-urls.js'

test('readFeedsFile ignores comments and blanks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feeds-'))
  const file = path.join(tmp, 'feeds.txt')
  fs.writeFileSync(file, '# comment\n\nhttp://a.com/rss\n https://b.com/feed\n')
  const feeds = readFeedsFile(file)
  assert.deepEqual(feeds, ['http://a.com/rss', 'https://b.com/feed'])
})

test('keepLikelyArticles filters non-articles', () => {
  assert.equal(keepLikelyArticles('https://example.com/2020/05/foo-bar'), true)
  assert.equal(keepLikelyArticles('https://example.com'), false)
})

test('extractFromRSS returns item links', () => {
  const xml = '<rss><channel><item><link>http://example.com/a</link></item></channel></rss>'
  assert.deepEqual(extractFromRSS(xml), ['http://example.com/a'])
})

test('extractFromSitemap returns loc entries', () => {
  const xml = '<urlset><url><loc>http://example.com/a</loc></url><url><loc>http://example.com/b</loc></url></urlset>'
  assert.deepEqual(extractFromSitemap(xml), ['http://example.com/a', 'http://example.com/b'])
})

test('makeBar respects width env', () => {
  process.env.FEED_BAR_WIDTH = '10'
  assert.equal(makeBar(30), '[###.......]')
})

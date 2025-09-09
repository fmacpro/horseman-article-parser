import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { makeBar, readUrls } from '../scripts/batch-crawl.js'

test('makeBar respects width env', () => {
  process.env.PROGRESS_BAR_WIDTH = '10'
  assert.equal(makeBar(50), '[#####.....]')
})

test('readUrls trims and filters lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urls-'))
  const file = path.join(tmpDir, 'u.txt')
  fs.writeFileSync(file, 'http://a.com\n\nhttp://b.com\n')
  const urls = readUrls(file)
  assert.deepEqual(urls, ['http://a.com', 'http://b.com'])
})

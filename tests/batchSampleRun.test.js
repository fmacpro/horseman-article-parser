import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ampCandidates, skipUrl, uniqueByHost, buildOptions, classifyError } from '../scripts/batch-sample-run.js'

test('ampCandidates generates variants', () => {
  const res = ampCandidates('https://example.com/news/story')
  assert.deepEqual(res, [
    'https://example.com/news/story/amp',
    'https://example.com/news/story/amp.html',
    'https://example.com/news/story?amp=1',
    'https://example.com/news/story?output=amp'
  ])
})

test('skipUrl identifies non-html resources', () => {
  assert.equal(skipUrl('ftp://example.com/file'), 'skip: non-http(s) scheme')
  assert.equal(skipUrl('https://example.com/file.pdf'), 'skip: non-html resource')
  assert.equal(skipUrl('https://example.com/article'), null)
})

test('uniqueByHost keeps first url per host', () => {
  const list = ['https://a.com/1', 'https://b.com/1', 'https://a.com/2']
  assert.deepEqual(uniqueByHost(list, 5), ['https://a.com/1', 'https://b.com/1'])
})

test('buildOptions sets defaults', () => {
  const opts = buildOptions('https://example.com', 1000)
  assert.equal(opts.url, 'https://example.com')
  assert.equal(opts.timeoutMs, 1000)
  assert.deepEqual(opts.blockedResourceTypes, ['media','font','stylesheet'])
})

test('classifyError groups messages', () => {
  assert.equal(classifyError('Timeout exceeded'), 'timeout')
  assert.equal(classifyError('403 Forbidden'), 'forbidden')
  assert.equal(classifyError('cookie consent needed'), 'consent')
  assert.equal(classifyError('Execution context destroyed'), 'context')
  assert.equal(classifyError('misc'), 'generic')
})

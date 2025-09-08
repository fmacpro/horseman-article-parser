import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setDefaultOptions, capitalizeFirstLetter, toTitleCase } from '../helpers.js'

test('setDefaultOptions applies defaults', () => {
  const opts = setDefaultOptions()
  assert.deepEqual(opts.enabled, ['links'])
  assert.equal(opts.timeoutMs, 10000)
  assert.equal(opts.puppeteer.launch.headless, true)
})

test('setDefaultOptions overrides provided values', () => {
  const opts = setDefaultOptions({ timeoutMs: 5000, puppeteer: { launch: { headless: false } } })
  assert.equal(opts.timeoutMs, 5000)
  assert.equal(opts.puppeteer.launch.headless, false)
  // ensure defaults not overwritten
  assert.equal(opts.puppeteer.launch.handleSIGINT, false)
})

test('setDefaultOptions deeply merges nested structures', () => {
  const opts = setDefaultOptions({
    enabled: ['links'],
    puppeteer: { launch: { args: ['--no-sandbox'] } }
  })
  assert.deepEqual(opts.enabled, ['links'])
  assert.equal(opts.puppeteer.launch.headless, true)
  assert.ok(opts.puppeteer.launch.args.includes('--no-sandbox'))
  assert.equal(opts.puppeteer.goto.waitUntil, 'domcontentloaded')
})

test('capitalizeFirstLetter capitalizes only first character', () => {
  assert.equal(capitalizeFirstLetter('hello'), 'Hello')
})

test('toTitleCase converts words to title case', () => {
  assert.equal(toTitleCase('hello world'), 'Hello World')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setDefaultOptions, capitalizeFirstLetter, toTitleCase, stripPunctuation, stripPossessive } from '../helpers.js'

test('setDefaultOptions applies defaults', () => {
  const opts = setDefaultOptions()
  assert.deepEqual(opts.enabled, ['links'])
  assert.equal(opts.timeoutMs, 40000)
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

test('setDefaultOptions does not duplicate links in enabled array', () => {
  const opts = setDefaultOptions({ enabled: ['links', 'extra'] })
  const linkCount = opts.enabled.filter(e => e === 'links').length
  assert.equal(linkCount, 1)
})

test('capitalizeFirstLetter capitalizes only first character', () => {
  assert.equal(capitalizeFirstLetter('hello'), 'Hello')
})

test('toTitleCase converts words to title case', () => {
  assert.equal(toTitleCase('hello world'), 'Hello World')
})

test('stripPunctuation removes punctuation without inserting spaces', () => {
  const input = 'one.two,three!four?five-six'
  const result = stripPunctuation(input)
  assert.equal(result, 'onetwothreefourfivesix')
})

test("stripPunctuation retains apostrophes", () => {
  const input = "Alice's adventures in Bob’s world!"
  const result = stripPunctuation(input)
  assert.equal(result, "Alice's adventures in Bob’s world")
})

test("stripPossessive removes trailing 's from last word", () => {
  assert.equal(stripPossessive("South Africa's"), 'South Africa')
  assert.equal(stripPossessive("America's"), 'America')
})

test("stripPossessive leaves non-final possessives", () => {
  assert.equal(stripPossessive("America's economy"), "America's economy")
})

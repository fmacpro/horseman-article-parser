import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { detectTitle } from '../controllers/titleDetector.js'

test('detectTitle prefers og:title meta', () => {
  const html = `<head><meta property="og:title" content="OG"><title>Doc</title></head><body><h1>Heading</h1></body>`
  const { window } = new JSDOM(html)
  assert.equal(detectTitle(window.document), 'OG')
})

test('detectTitle falls back to h1 and strips suffix', () => {
  const html = `<head><title>Heading - Site</title></head><body><h1>Heading - Site</h1></body>`
  const { window } = new JSDOM(html)
  assert.equal(detectTitle(window.document), 'Heading')
})

test('detectTitle uses twitter:title when available', () => {
  const html = `<head><meta name="twitter:title" content="Tweet Title"><title>Fallback</title></head>`
  const { window } = new JSDOM(`<html>${html}<body></body></html>`)
  assert.equal(detectTitle(window.document), 'Tweet Title')
})

test('detectTitle strips site suffix with vertical bar', () => {
  const html = `<head><title>Story | Example.com</title></head><body></body>`
  const { window } = new JSDOM(html)
  assert.equal(detectTitle(window.document), 'Story')
})

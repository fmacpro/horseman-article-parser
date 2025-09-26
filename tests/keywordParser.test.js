import { test } from 'node:test'
import assert from 'node:assert/strict'
import keywordParser from '../controllers/keywordParser.js'

test('keywordParser respects French language stopwords and filters nav noise', async () => {
  const text = [
    'A Marseille, le prefet s oppose a la creation dune salle de shoot.',
    'Des collectifs dhabitan ts reclament une Halte Soins Addiction pres de la rue DAubagne.',
    'SPORT BUSINESS SPORT BUSINESS BEBES ET MAMANS BEBES MINUTES.',
    'Le ministre de la Sante promet une reponse avant lhiver.'
  ].join(' ')

  const res = await keywordParser(text, { lang: 'fr', language: { iso6391: 'fr' }, maximum: 6 })
  const keywords = res.keywords.map(item => item.keyword)
  const keyphrases = res.keyphrases.map(item => item.keyphrase)

  assert.ok(keywords.includes('Marseille'))
  assert.ok(!keywords.some(item => ['SPORT', 'BEBES', 'BUSINESS'].includes(item)))
  assert.ok(!keywords.includes('Des'))
  assert.ok(!keyphrases.some(phrase => phrase.includes('SPORT BUSINESS')))
})

test('keywordParser keeps upper-case acronyms while removing long shouty words', async () => {
  const text = [
    'L ONG WWF presente un rapport sur la pollution.',
    'Les ministres du G7 se reunissent a Paris pour discuter du climat.',
    'ECONOMIE ECONOMIE ECONOMIE',
    'Les ONG demandent des mesures concretes.'
  ].join(' ')

  const res = await keywordParser(text, { lang: 'fr', language: { iso6391: 'fr' }, maximum: 6 })
  const keywords = res.keywords.map(item => item.keyword)

  assert.ok(keywords.includes('WWF'))
  assert.ok(keywords.includes('G7'))
  assert.ok(!keywords.includes('ECONOMIE'))
})

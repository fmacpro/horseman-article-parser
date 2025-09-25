import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSummary } from '../controllers/summary.js'

test('buildSummary selects informative sentences across the article', () => {
  const text = [
    'Check your heating before winter starts.',
    'The Energy Saving Trust says 60% of bills go to heating.',
    'This simple audit can prevent breakdowns.',
    '',
    'Draft proofing doors can cut bills by 15%, according to Ofgem.',
    'The charity adds that sealing windows helps older homes.',
    '',
    'Smart meters help track usage, the report found.',
    'Residents in Glasgow saved \u00a3120 last year.',
    'Support is available for low-income households.'
  ].join('\n')

  const context = {
    title: 'How to prepare your home for winter',
    metaDescription: 'Check heating, seal draughts and use smart meters to cut bills'
  }

  const summary = buildSummary(text, context)

  assert.ok(summary.sentences.length >= 3 && summary.sentences.length <= 5)
  assert.ok(summary.sentences.includes('Check your heating before winter starts.'))
  assert.ok(summary.sentences.some(sentence => sentence.includes('15%')))
  assert.ok(summary.sentences.some(sentence => sentence.startsWith('Smart meters help track usage')))
  assert.ok(summary.sentences.some(sentence => /\d/.test(sentence)))

  const positions = summary.sentences.map(sentence => text.indexOf(sentence))
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1])
  }
})

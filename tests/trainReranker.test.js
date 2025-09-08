import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsvLine, parseCSV, train } from '../scripts/train-reranker.js'

test('parseCsvLine handles quoted commas', () => {
  const fields = parseCsvLine('a,"b,c",d')
  assert.deepEqual(fields, ['a', 'b,c', 'd'])
})

test('parseCSV builds rows with vectors', () => {
  const csv = `text_length,punctuation_count,link_density,paragraph_count,has_semantic_container,boilerplate_penalty,direct_paragraph_count,direct_block_count,paragraph_to_block_ratio,average_paragraph_length,dom_depth,heading_children_count,aria_role_main,aria_role_negative,aria_hidden,image_alt_ratio,image_count,training_label\n` +
    `10,5,0.1,2,1,0.5,1,1,0.5,100,3,0,1,0,0,0.2,1,1\n` +
    `20,8,0.2,4,0,0.1,2,2,1,150,5,1,0,0,0,0.3,0,0\n`
  const rows = parseCSV(csv)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].x.length, 16)
  assert.equal(rows[1].y, 0)
})

test('train returns weights and bias', () => {
  const data = [{ x: [0,0], y: 0 }, { x: [1,1], y: 1 }]
  const model = train(data, { epochs: 10, lr: 0.1 })
  assert.equal(model.weights.length, 2)
  assert.equal(typeof model.bias, 'number')
})

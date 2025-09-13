import { test } from 'node:test'
import assert from 'node:assert/strict'
import entityParser from '../controllers/entityParser.js'

test('entityParser capitalizes extracted entities', () => {
  const input = 'john doe went to paris. google and microsoft.'
  const res = entityParser(input, { first: [], last: [] }, () => 2000)
  const arrays = [res.people, res.places, res.orgs, res.topics]
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const val of arr) {
        assert.equal(val[0], val[0].toUpperCase())
      }
    }
  }
})

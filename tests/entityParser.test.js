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

test("entityParser removes trailing possessive 's", () => {
  const input = "Angela's phone was found in Paris's museum run by Google's team"
  const res = entityParser(input, { first: [], last: [] }, () => 2000)
  assert.deepEqual(res.people, ['Angela'])
  assert.deepEqual(res.places, ['Paris'])
  assert.deepEqual(res.orgs, ['Google'])
  assert(!res.people.some(p => /'s$/i.test(p)))
  assert(!res.places?.some(p => /'s$/i.test(p)))
  assert(!res.orgs?.some(o => /'s$/i.test(o)))
})

test("entityParser strips possessive for multi-word people", () => {
  const input = "Mr Trump's visit impressed Mrs May's supporters"
  const res = entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.people.includes('Mr Trump'))
  assert(res.people.includes('Mrs May'))
  assert(!res.people.some(p => /'s$/i.test(p)))
})

test("entityParser keeps possessive for multi-word entities", () => {
  const input = "The United States's economy continues to grow"
  const res = entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.places.includes("United States's"))
  assert(res.topics.includes("United States's"))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import entityParser from '../controllers/entityParser.js'
import { loadNlpPlugins } from '../controllers/nlpPlugins.js'

test('entityParser capitalizes extracted entities', async () => {
  const input = 'john doe went to paris. google and microsoft.'
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  const arrays = [res.people, res.places, res.orgs, res.topics]
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const val of arr) {
        assert.equal(val[0], val[0].toUpperCase())
      }
    }
  }
})

test("entityParser removes trailing possessive 's", async () => {
  const input = "Angela's phone was found in Paris's museum run by Google's team"
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  assert.deepEqual(res.people, ['Angela'])
  assert.deepEqual(res.places, ['Paris'])
  assert.deepEqual(res.orgs, ['Google'])
  assert(!res.people.some(p => /'s$/i.test(p)))
  assert(!res.places?.some(p => /'s$/i.test(p)))
  assert(!res.orgs?.some(o => /'s$/i.test(o)))
})

test("entityParser strips possessive for multi-word people", async () => {
  const input = "Mr Trump's visit impressed Mrs May's supporters"
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.people.includes('Mr Trump'))
  assert(res.people.includes('Mrs May'))
  assert(!res.people.some(p => /'s$/i.test(p)))
})

test("entityParser strips possessive for multi-word entities", async () => {
  const input = "The United States's economy continues to grow"
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.places.includes('United States'))
  assert(res.topics.includes('United States'))
  assert(!res.places.some(p => /'s$/i.test(p)))
  assert(!res.topics.some(t => /'s$/i.test(t)))
})

test("entityParser handles possessive places with trailing punctuation", async () => {
  const input = "He returned from New Zealand's."
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.places.includes('New Zealand'))
  assert(!res.places.some(p => /['’]s/i.test(p)))
})

test('entityParser preserves hyphenated names', async () => {
  const input = 'Jean-Luc Picard met Jean-Luc Picard'
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.people.includes('Jean-Luc Picard'))
})

test('entityParser splits adjacent names using secondary hints', async () => {
  const input = 'John Mary arrived together.'
  const res = await entityParser(input, { first: [], last: [], secondary: { people: ['John', 'Mary'] } }, () => 2000)
  assert.deepEqual(res.people, ['John', 'Mary'])
})

test('entityParser falls back when secondary service fails', async () => {
  const input = 'Alice Johnson outlined the plan.'
  const res = await entityParser(input, {
    first: [],
    last: [],
    secondary: {
      fetcher: async () => { throw new Error('service down') }
    }
  }, () => 2000)
  assert(res.people.includes('Alice Johnson'))
})

test('entityParser respects middle and suffix hints for complex names', async () => {
  const input = 'Dr. José Luis Rodríguez Jr. met Ana María López in Madrid.'
  const hints = {
    first: ['José', 'Ana'],
    middle: ['Luis', 'María'],
    last: ['Rodríguez', 'López'],
    suffix: ['Jr']
  }
  const res = await entityParser(input, hints, () => 2000)
  assert(res.people.some(name => /José Luis Rodríguez Jr/.test(name)))
  assert(res.people.some(name => /Ana María López/.test(name)))
})

test('entityParser extracts acknowledgement name lists', async () => {
  const input = `Acknowledgements: Borja Balle, Zachary Charles, Christopher A. Choquette-Choo, Lynn Chua, Badih Ghazi, Da Yu, Chiyuan Zhang.`
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  const expected = [
    'Borja Balle',
    'Zachary Charles',
    'Christopher A Choquette-Choo',
    'Lynn Chua',
    'Badih Ghazi',
    'Da Yu',
    'Chiyuan Zhang'
  ]
  for (const name of expected) {
    assert(res.people.includes(name))
  }
  assert(!res.people.includes('Christopher'))
})

test('entityParser splits acknowledgement lists separated by semicolons', async () => {
  const input = `Thanks to Zachary Charles; Christopher A. Choquette-Choo; Lynn Chua; Peter Kairouz.`
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  const expected = [
    'Zachary Charles',
    'Christopher A Choquette-Choo',
    'Lynn Chua',
    'Peter Kairouz'
  ]
  for (const name of expected) {
    assert(res.people.includes(name), `${name} not found in ${JSON.stringify(res.people)}`)
  }
  assert(!res.people.some(name => /Zachary Charles Christopher/.test(name)))
})

test('entityParser splits acknowledgement runs without punctuation', async () => {
  const input = `Thanks to Peter Kairouz Brendan McMahan Dan Ramage Mark Simborg Kimberly Schwede Borja Balle Zachary Charles Christopher A. Choquette-Choo Lynn Chua Prem Eruvbetine Badih Ghazi Steve He Yangsibo Huang Armand Joulin George Kaissis Pritish Kamath Ravi Kumar Daogao Liu Ruibo Liu Pasin Manurangsi Thomas Mesnard Andreas Terzis Tris Warkentin Da Yu Chiyuan Zhang.`
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  const expected = [
    'Peter Kairouz',
    'Brendan McMahan',
    'Dan Ramage',
    'Mark Simborg',
    'Kimberly Schwede',
    'Borja Balle',
    'Zachary Charles',
    'Christopher A Choquette-Choo',
    'Lynn Chua',
    'Prem Eruvbetine',
    'Badih Ghazi',
    'Steve He',
    'Yangsibo Huang',
    'Armand Joulin',
    'George Kaissis',
    'Pritish Kamath',
    'Ravi Kumar',
    'Daogao Liu',
    'Ruibo Liu',
    'Pasin Manurangsi',
    'Thomas Mesnard',
    'Andreas Terzis',
    'Tris Warkentin',
    'Da Yu',
    'Chiyuan Zhang'
  ]
  for (const name of expected) {
    assert(res.people.includes(name), `${name} not found in ${JSON.stringify(res.people)}`)
  }
  assert(!res.people.some(name => /Kairouz Brendan McMahan/.test(name)))
})

test('entityParser keeps dense acknowledgements together when surnames are unknown', async () => {
  const input = 'Thanks to John Qwerty Mary Asdf for their help.'
  const res = await entityParser(input, { first: [], last: [] }, () => 2000)
  assert(res.people.includes('John Qwerty'))
  assert(res.people.includes('Mary Asdf'))
  assert(!res.people.includes('John'))
  assert(!res.people.includes('Qwerty'))
  assert(!res.people.includes('Mary'))
  assert(!res.people.includes('Asdf'))
})

test('loadNlpPlugins collects extended hints and secondary config', () => {
  const plugin = (_Doc, world) => {
    world.addWords({
      Carlos: 'FirstName',
      Ramirez: 'LastName',
      Jr: 'Suffix'
    })
  }
  const hints = loadNlpPlugins({
    nlp: {
      plugins: [plugin],
      hints: { middle: ['Luis'] },
      secondary: { endpoint: 'https://ner.example/api', method: 'post' }
    }
  })
  assert(hints.first.includes('Carlos'))
  assert(hints.last.includes('Ramirez'))
  assert(hints.middle.includes('Luis'))
  assert(hints.suffix.includes('Jr'))
  assert.equal(hints.secondary.endpoint, 'https://ner.example/api')
  assert.equal(hints.secondary.method, 'post')
})

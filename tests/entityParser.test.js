import { test } from 'node:test'
import assert from 'node:assert/strict'
import entityParser from '../controllers/entityParser.js'
import { stripPunctuation } from '../helpers.js'
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

test('entityParser removes concatenated acknowledgement blobs with conjunctions', async () => {
  const input = `Thanks to Peter Kairouz Brendan McMahan Dan Ramage Mark Simborg Kimberly Schwede Borja Balle Zachary Charles Christopher A. Choquette-Choo Lynn Chua Prem Eruvbetine Badih Ghazi Steve He Yangsibo Huang Armand Joulin George Kaissis Pritish Kamath Ravi Kumar Daogao Liu Ruibo Liu Pasin Manurangsi Thomas Mesnard Andreas Terzis Tris Warkentin and Da Yu.`
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
    'Da Yu'
  ]
  for (const name of expected) {
    assert(res.people.includes(name), `${name} not found in ${JSON.stringify(res.people)}`)
  }
  assert(!res.people.some(name => /Peter Kairouz Brendan McMahan/.test(name)))
})

test('entityParser handles punctuation-stripped acknowledgement lists', async () => {
  const raw = `We'd like to thank the entire Gemma and Google Privacy teams for their contributions and support throughout this project, in particular, Peter Kairouz, Brendan McMahan and Dan Ramage for feedback on the blog post, Mark Simborg and Kimberly Schwede for help with visualizations, and the teams at Google that helped with algorithm design, infrastructure implementation, and production maintenance. The following people directly contributed to the work presented here (ordered alphabetically): Borja Balle, Zachary Charles, Christopher A. Choquette-Choo, Lynn Chua, Prem Eruvbetine, Badih Ghazi, Steve He, Yangsibo Huang, Armand Joulin, George Kaissis, Pritish Kamath, Ravi Kumar, Daogao Liu, Ruibo Liu, Pasin Manurangsi, Thomas Mesnard, Andreas Terzis, Tris Warkentin, Da Yu, and Chiyuan Zhang.`
  const sanitized = stripPunctuation(raw)
  const res = await entityParser(sanitized, { first: [], last: [] }, () => 3000)
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
  const unexpected = [
    'Peter Kairouz Brendan McMahan',
    'Zachary Charles Christopher',
    'Choquette-Choo Lynn Chua',
    'Choo Lynn Chua',
    'Research Scientist',
    'Google Research We'
  ]
  for (const name of unexpected) {
    assert(!res.people.includes(name), `${name} should not be present in ${JSON.stringify(res.people)}`)
  }
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

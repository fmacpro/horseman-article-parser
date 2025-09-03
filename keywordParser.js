const retext = require('retext')
const nlcstToString = require('nlcst-to-string')
const pos = require('retext-pos')
const keywords = require('retext-keywords')
const _ = require('lodash')

module.exports = async function keywordParser (html, options = { maximum: 10 }) {
  const file = await retext().use(pos).use(keywords, options).process(html)

  const keywordsArr = file.data.keywords.map(keyword => ({
    keyword: nlcstToString(keyword.matches[0].node),
    score: keyword.score
  }))

  const keyphrases = file.data.keyphrases.map(phrase => {
    const nodes = phrase.matches[0].nodes
    const tree = _.map(nodes)
    return {
      keyphrase: nlcstToString(tree, ''),
      score: phrase.score,
      weight: phrase.weight
    }
  }).sort((a, b) => (a.score > b.score) ? -1 : 1)

  return { keywords: keywordsArr, keyphrases }
}

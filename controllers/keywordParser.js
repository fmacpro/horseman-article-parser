import { retext } from 'retext'
import { toString as nlcstToString } from 'nlcst-to-string'
import pos from 'retext-pos'
import keywords from 'retext-keywords'
import language from 'retext-language'
import _ from 'lodash'
import { capitalizeFirstLetter, stripPossessive } from '../helpers.js'

export default async function keywordParser (html, options = { maximum: 10 }) {
  const { lang, ...rest } = options || {}
  const processor = retext()
  if (lang) processor.use(language, { language: lang })
  processor.use(pos).use(keywords, rest)
  const file = await processor.process(html)

  const keywordsArr = file.data.keywords.map(keyword => ({
    keyword: capitalizeFirstLetter(stripPossessive(nlcstToString(keyword.matches[0].node))),
    score: keyword.score
  }))

  const keyphrases = file.data.keyphrases.map(phrase => {
    const nodes = phrase.matches[0].nodes
    const tree = _.map(nodes)
    const kp = stripPossessive(nlcstToString(tree, ''))
    return {
      keyphrase: capitalizeFirstLetter(kp),
      score: phrase.score,
      weight: phrase.weight
    }
  }).sort((a, b) => (a.score > b.score) ? -1 : 1)

  return { keywords: keywordsArr, keyphrases }
}

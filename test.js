const parser = require('./index.js')
const fs = require('fs')

const options = {
  url: 'https://www.facebook.com/theSNP/posts/10157713206314078?__xts__[0]=68.ARBoNpoPePPidcVdwLUUTldfnZ4am0mpQcRttEc7CODxbTPJwM2FxPNouEiKBFnIpFkwhNXuqWbQjY-GuFbgJYpexlJT_fT49-upAdjVh5knQwOWPpKwVCKYFq93feZ4N-pcY5Z9PZJ-V13ivZDo3N0LmKrB7KyeU2D9Q6zyYUDIvWZFHvFyOgImmXJdVX5Blya4ZfttMhTRuEfo8Gbgl4PAtBu4M55fIb7t42HTGz8UD1BcLYz54dqShBKe9hUn9fhV_ARlB9kSwGHTIqfXgqfZJ9KT8TPVULIX8kOK8CqUzs47k05dSjQ_aEE65anM2IjGGLEnW36Vtuq44ZIXPDTbN6XZcCrGMtLAERgJ42ZlhICOOM15sBObTXMFWykcB4jp7e-eDiV19skDCRWxcOsdb4KKSjnVG679cTPki8oZcY9nFgtxhzQcIMlDlmGEfLJY6jAaoyK9yYd9QpnfepkZsYj81HblAmRXUdoaecHDn-uHsgqGiMHArFoO76w&__tn__=C-R',
  // enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords']
  enabled: ['links', 'sentiment', 'entities', 'spelling', 'keywords']
}

parser.parseArticle(options)
  .then(function (article) {
    const response = {
      title: article.title.text,
      excerpt: article.excerpt,
      metadescription: article.meta.description.text,
      url: article.url,
      sentiment: { score: article.sentiment.score, comparative: article.sentiment.comparative },
      keyphrases: article.processed.keyphrases,
      keywords: article.processed.keywords,
      people: article.people,
      orgs: article.orgs,
      places: article.places,
      text: {
        raw: article.processed.text.raw,
        formatted: article.processed.text.formatted,
        html: article.processed.text.html
      },
      spelling: article.spelling,
      meta: article.meta,
      links: article.links,
      lighthouse: article.lighthouse
    }

    const json = JSON.stringify(response, null, 4)
    fs.writeFile('testresults.json', json, 'utf8', function (err) {
      if (err) throw err
      console.log('Results written to testresults.json')
    })
  })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack)
  })

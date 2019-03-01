var parser = require('./index.js')
var fs = require('fs');

var options = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
  url: 'https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth'
}

parser.parseArticle(options)
  .then(function (article) {
    var response = {
      title: article.title.text,
      metadescription: article.meta.description.text,
      url: article.url,
      sentiment: { score: article.sentiment.score, comparative: article.sentiment.comparative },
      keyphrases: article.processed.keyphrases,
      people: article.people,
      orgs: article.orgs,
      places: article.places,
      text: {
        raw: article.processed.text.raw,
        formatted: article.processed.text.formatted,
        html: article.processed.text.html
      },
      spelling: article.spelling,
      lighthouse: article.lighthouse
    }
    var json = JSON.stringify(response, null, 4);
    fs.writeFile('testresults.json', json, 'utf8', function(err) {
      if (err) throw err;
      console.log('Results written to testresults.json');
    });
  })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack)
  })

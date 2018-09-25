# Horseman Article Parser

A web page article parser which returns an object containing the article's formatted text & other attributes including sentiment, keyphrases, people, places, organisations and spelling suggestions. 

### Prerequisites

Node.js & NPM

### Install

```
npm install horseman-article-parser --save
```

### Usage Example

```
var parser = require('horseman-article-parser');

var params = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
  config: { timeout: 10000, cookies: './cookies.json', bluebirdDebug: false, injectJquery: true },
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth"
}

parser.parseArticle(params)
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
        formatted: article.processed.formattedText,
        html: article.processed.html
      },
      spelling: article.spelling
    }

    console.log(response);
  })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack);
  })
```

## Development

Please feel free to fork the repo or open pull requests to the development branch. I've used [eslint](https://eslint.org/) for linting & [yarn](https://yarnpkg.com/en/) for dependency management. 

Build the dependencies with:
```
yarn
```

Lint the index.js file with:
```
yarn lint
```

## License

This project is licensed under the GNU GENERAL PUBLIC LICENSE Version 3 - see the [LICENSE.md](LICENSE.md) file for details
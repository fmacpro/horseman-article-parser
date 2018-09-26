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

var options = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth"
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
      spelling: article.spelling
    }

    console.log(response);
  })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack);
  })
```


`parseArticle(params, <socket>)` accepts an optional socket for pipeing status messages and errors to a front end UI. 


### Options

The options below are set by default

```
var options = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
  horseman: {
    timeout: 10000, 
    cookies: './cookies.json'
  },
  htmlcleaner: {
    'add-remove-tags': ['blockquote', 'span'],
    'remove-empty-tags': ['span'],
    'replace-nbsp': true
  },
  readability: {},
  texttohtml: {
    wordwrap: 100,
    noLinkBrackets: true,
    ignoreHref: true,
    tables: true,
    uppercaseHeadings: true
  },
  retextkeywords: { maximum: 10 },
  retextspell: {}
}
```

At a minimum you should pass a url

```
var options = {
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth"
}
```

See [horseman-article-parser-ui](https://github.com/fmacpro/horseman-article-parser-ui) as an example.


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

## Dependencies

- [clean-html](https://ghub.io/clean-html): HTML cleaner and beautifier
- [compromise](https://ghub.io/compromise): natural language processing in the browser
- [dictionary-en-gb](https://ghub.io/dictionary-en-gb): English (United Kingdom) spelling dictionary in UTF-8
- [html-to-text](https://ghub.io/html-to-text): Advanced html to plain text converter
- [lodash](https://ghub.io/lodash): Lodash modular utilities.
- [node-horseman](https://ghub.io/node-horseman): Run PhantomJS from Node
- [nlcst-to-string](https://ghub.io/nlcst-to-string): Stringify NLCST
- [node-readability](https://ghub.io/node-readability): Turning any web page into a clean view.
- [phantomjs-prebuilt](https://ghub.io/phantomjs-prebuilt): Headless WebKit with JS API
- [retext](https://ghub.io/retext): Natural language processor powered by plugins
- [retext-keywords](https://ghub.io/retext-keywords): Keyword extraction with Retext
- [retext-spell](https://ghub.io/retext-spell): Spelling checker for retext
- [sentiment](https://ghub.io/sentiment): AFINN-based sentiment analysis for Node.js
- [vfile-reporter-json](https://ghub.io/vfile-reporter-json): JSON reporter for virtual files

## Dev Dependencies

- [eslint](https://ghub.io/eslint): An AST-based pattern checker for JavaScript.
- [eslint-config-standard](https://ghub.io/eslint-config-standard): JavaScript Standard Style - ESLint Shareable Config
- [eslint-plugin-import](https://ghub.io/eslint-plugin-import): Import with sanity.
- [eslint-plugin-node](https://ghub.io/eslint-plugin-node): Additional ESLint&#39;s rules for Node.js
- [eslint-plugin-promise](https://ghub.io/eslint-plugin-promise): Enforce best practices for JavaScript promises
- [eslint-plugin-standard](https://ghub.io/eslint-plugin-standard): ESlint Plugin for the Standard Linter

## License

This project is licensed under the GNU GENERAL PUBLIC LICENSE Version 3 - see the [LICENSE.md](LICENSE.md) file for details

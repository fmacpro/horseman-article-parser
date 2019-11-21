# Horseman Article Parser

A web page article parser which returns an object containing the article's formatted text and other attributes including sentiment, keyphrases, people, places, organisations, spelling suggestions, in-article links, meta data & lighthouse audit results. 

### Prerequisites

Node.js & NPM

### Install

```
npm install horseman-article-parser --save
```

### Usage

#### parseArticle(options, socket) ⇒ <code>Object</code>

**Returns**: <code>Object</code> - article parser results object  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | the options object |
| socket | <code>Object</code> | the optional socket |

### Usage Example

```
var parser = require('horseman-article-parser');

var options = {
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth",
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords']
}

parser.parseArticle(options)
  .then(function (article) {

    var response = {
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

    console.log(response);
  })
  .catch(function (error) {
    console.log(error.message)
    console.log(error.stack);
  })
```


`parseArticle(options, <socket>)` accepts an optional socket for pipeing the response object, status messages and errors to a front end UI. 

See [horseman-article-parser-ui](https://github.com/fmacpro/horseman-article-parser-ui) as an example.

### Options

The options below are set by default

```
var options = {
  // puppeteer options (https://github.com/GoogleChrome/puppeteer)
  puppeteer: {
    // puppeteer launch options (https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions)
    launch: {
      headless: true,
      defaultViewport: null
    },
    // puppeteer goto options (https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options)
    goto: {
      waitUntil: 'domcontentloaded'
    }
  },
  // clean-html options (https://ghub.io/clean-html)
  cleanhtml: {
    'add-remove-tags': ['blockquote', 'span'],
    'remove-empty-tags': ['span'],
    'replace-nbsp': true
  },
  // html-to-text options (https://ghub.io/html-to-text)
  htmltotext: {
    wordwrap: 100,
    noLinkBrackets: true,
    ignoreHref: true,
    tables: true,
    uppercaseHeadings: true
  },
  // retext-keywords options (https://ghub.io/retext-keywords)
  retextkeywords: { maximum: 10 }
}
```

At a minimum you should pass a url

```
var options = {
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth"
}
```

If you want to enable the advanced features you should pass the following

```
var options = {
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth",
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords']
}
```

If you want to pass cookies to puppeteer use the following

```
var options = {
  puppeteer: {
    cookies: [{ name: 'cookie1', value: 'val1', domain: '.domain1' },{ name: 'cookie2', value: 'val2', domain: '.domain2' }]
  }
}
```

To strip tags before processing use the following

```
var options = {
  striptags: ['.something', '#somethingelse']
}
```

If you need to dismiss any popups e.g. a privacy popup use the following

```
var options = {
  clickelements: ['#button1', '#button2']
}
```

there are some additional "complex" options available

```
var options = {
  // array of html elements to stip before analysis
  striptags: [],
  // readability options (https://ghub.io/node-readability)
  readability: {},
  // retext spell options (https://ghub.io/retext-spell)
  retextspell: {}
}
```

## Development

Please feel free to fork the repo or open pull requests to the development branch. I've used [eslint](https://eslint.org/) for linting. 

Build the dependencies with:
```
npm install
```

Lint the project files with:
```
npm run lint
```

Test the package with:
```
npm run test
```

## Dependencies

- [Puppeteer](https://github.com/GoogleChrome/puppeteer/): High-level API to control Chrome or Chromium over the DevTools Protocol
- [compromise](https://ghub.io/compromise): natural language processing in the browser
- [retext](https://ghub.io/retext): Natural language processor powered by plugins
- [retext-pos](https://github.com/retextjs/retext-pos): Plugin to add part-of-speech (POS) tags
- [retext-keywords](https://ghub.io/retext-keywords): Keyword extraction with Retext
- [retext-spell](https://ghub.io/retext-spell): Spelling checker for retext
- [sentiment](https://ghub.io/sentiment): AFINN-based sentiment analysis for Node.js
- [jquery](https://ghub.io/jquery): JavaScript library for DOM operations
- [jsdom](https://ghub.io/jsdom): A JavaScript implementation of many web standards
- [lodash](https://ghub.io/lodash): Lodash modular utilities.
- [absolutify](https://ghub.io/absolutify): Relative to Absolute URL Replacer
- [clean-html](https://ghub.io/clean-html): HTML cleaner and beautifier
- [dictionary-en-gb](https://ghub.io/dictionary-en-gb): English (United Kingdom) spelling dictionary in UTF-8
- [html-to-text](https://ghub.io/html-to-text): Advanced html to plain text converter
- [nlcst-to-string](https://ghub.io/nlcst-to-string): Stringify NLCST
- [vfile-reporter-json](https://ghub.io/vfile-reporter-json): JSON reporter for virtual files


## Dev Dependencies

- [eslint](https://ghub.io/eslint): An AST-based pattern checker for JavaScript.
- [eslint-config-standard](https://ghub.io/eslint-config-standard): JavaScript Standard Style - ESLint Shareable Config
- [eslint-plugin-import](https://ghub.io/eslint-plugin-import): Import with sanity.
- [eslint-plugin-json](https://ghub.io/eslint-plugin-json): Lint JSON files
- [eslint-plugin-node](https://ghub.io/eslint-plugin-node): Additional ESLint&#39;s rules for Node.js
- [eslint-plugin-promise](https://ghub.io/eslint-plugin-promise): Enforce best practices for JavaScript promises
- [eslint-plugin-standard](https://ghub.io/eslint-plugin-standard): ESlint Plugin for the Standard Linter


## License

This project is licensed under the GNU GENERAL PUBLIC LICENSE Version 3 - see the [LICENSE](LICENSE) file for details

## Notes

Due to [node-readability](https://github.com/luin/readability) being stale I have imported the relevent functions into this project and refactored it so it doesn't use [request](https://github.com/request/request) and therfor has no vulnrabilities.

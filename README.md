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

| Param   | Type                | Description         |
| ------- | ------------------- | ------------------- |
| options | <code>Object</code> | the options object  |
| socket  | <code>Object</code> | the optional socket |

**Returns**: <code>Object</code> - article parser results object

### Usage Example

```
import { parseArticle } from 'horseman-article-parser';

const options = {
  url: "https://www.theguardian.com/politics/2018/sep/24/theresa-may-calls-for-immigration-based-on-skills-and-wealth",
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords']
}

parseArticle(options)
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
    // Optional user agent and headers (some sites require a realistic UA)
    // userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    // extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    // puppeteer goto options (https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options)
    goto: {
      waitUntil: 'domcontentloaded'
    },
    // Ignore content security policy
    setBypassCSP: true
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
  retextkeywords: { maximum: 10 },
  // content detection defaults (detector is always enabled)
  contentDetection: {
    // minimum characters required for a candidate
    minLength: 400,
    // maximum link density allowed for a candidate
    maxLinkDensity: 0.5,
    // reranker is disabled by default; enable after training weights
    // Note: test.js auto-loads weights.json (if present) and enables the reranker
    reranker: { enabled: false }
    // optional: dump top-N candidates per page for labeling
    // debugDump: { path: 'candidates_with_url.csv', topN: 5, addUrl: true }
  },
  // retext-spell defaults and output tweaks
  retextspell: {
    tweaks: {
      // filter URL/domain-like tokens and long slugs by default
      ignoreUrlLike: true,
      // positions: only start by default
      includeEndPosition: false,
      // offsets excluded by default
      includeOffsets: false
    }
  }
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

You may pass rules for returning an articles title & contents. This is useful in a case
where the parser is unable to return the desired title or content e.g.

```
rules: [
  {
    host: 'www.bbc.co.uk',
    content: () => {
      var j = window.$
      j('article section, article figure, article header').remove()
      return j('article').html()
    }
  },
  {
    host: 'www.youtube.com',
    title: () => {
      return window.ytInitialData.contents.twoColumnWatchNextResults.results.results.contents[0].videoPrimaryInfoRenderer.title.runs[0].text
    },
    content: () => {
      return window.ytInitialData.contents.twoColumnWatchNextResults.results.results.contents[1].videoSecondaryInfoRenderer.description.runs[0].text
    }
  }
]
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

  // array of resource types to block e.g. ['image' ]
  blockedResourceTypes: [],

  // array of resource source names (all resources from
  // these sources are skipped) e.g. [ 'google', 'facebook' ]
  skippedResources: [],


  // retext spell options (https://ghub.io/retext-spell)
  retextspell: {
    // dictionary defaults to en-GB; you can override
    // dictionary,
    tweaks: {
      // Filter URL/domain-like tokens and long slugs (default: true)
      ignoreUrlLike: true,
      // Include end position (endLine/endColumn) in each item (default: false)
      includeEndPosition: false,
      // Include offsets (offsetStart/offsetEnd) in each item (default: false)
      includeOffsets: false
    }
  }

  // compromise nlp options
  nlp: { plugins: [ myPlugin, anotherPlugin ] }

}
```

### Using Compromise plugins to improve results

Compromise is the natural language processor that allows `horseman-article-parser` to return
topics e.g. people, places & organisations. You can now pass custom plugins to compromise to modify or add to the word lists like so:

```
/** add some names
let testPlugin = function(Doc, world) {
  world.addWords({
    'rishi': 'FirstName',
    'sunak': 'LastName',
  })
}

const options = {
  url: 'https://www.theguardian.com/commentisfree/2020/jul/08/the-guardian-view-on-rishi-sunak-right-words-right-focus-wrong-policies',
  enabled: ['lighthouse', 'screenshot', 'links', 'sentiment', 'entities', 'spelling', 'keywords'],
  // Optional: tweak spelling output/filters
  retextspell: {
    tweaks: {
      ignoreUrlLike: true,
      includeEndPosition: true,
      includeOffsets: true
    }
  },
  nlp: {
    plugins: [testPlugin]
  }
}
```

This allows us to match - for example - names which are not in the base compromise word lists.

Check out the compromise plugin [docs](https://observablehq.com/@spencermountain/compromise-plugins) for more info.

## Development

Please feel free to fork the repo or open pull requests to the development branch. I've used [eslint](https://eslint.org/) for linting.

[Module API Docs](https://github.com/fmacpro/horseman-article-parser/blob/development/APIDOC.md)

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

### Content Detection

The detector is always enabled and uses a structured-data-first strategy, falling back to heuristic scoring:
- Structured data: Extracts JSON-LD Article/NewsArticle (`headline`, `articleBody`).
- Heuristics: Gathers DOM candidates (e.g., `article`, `main`, `[role=main]`, content-like containers) and scores them by text length, punctuation, link density, paragraph count, semantic tags, and boilerplate penalties.
- Title detection: Chooses from structured `headline`, `og:title`/`twitter:title`, first `<h1>`, or `document.title`, with normalization.

You can optionally tune thresholds under `options.contentDetection`:
```
contentDetection: {
  minLength: 400,
  maxLinkDensity: 0.5
}
```

### Training the Reranker (optional)

You can train a simple logistic‑regression reranker to improve candidate selection.

1) Generate candidate features
- Single URL (appends candidates):
  - `node test.js`
- Batch (recommended):
  - `node scripts/batch-crawl.js urls.txt candidates_with_url.csv 0 200`
  - Adjust `start` and `limit` to process in slices (e.g., `200 200`, `400 200`, ...).
- The project dumps candidates with URL by default (see `test.js`):
  - Header: `url,xpath,len,punct,ld,pc,sem,boiler,label`
  - Up to `topN` rows per page (default 5)

2) Label the dataset
- Open `candidates_with_url.csv` in a spreadsheet/editor.
- For each URL group, set `label = 1` for the correct article body candidate (leave others as 0).
- Column meanings:
  - `url`: source page
  - `xpath`: DOM XPath of the candidate container to help locate it in DevTools
  - `len`: raw character length (the trainer log‑scales internally)
  - `punct`: count of punctuation (.,!?,;:)
  - `ld`: link density (0..1)
  - `pc`: paragraph/line‑break count
  - `sem`: 1 if within `article`/`main`/`role=main`/`itemtype*=Article`, else 0
  - `boiler`: number of boilerplate containers detected (nav/aside/comments/social/newsletter/consent)
  - `label`: 1 for the true article candidate; 0 otherwise

3) Train weights and export JSON
- Direct (avoids npm banner output):
  - `node scripts/train-reranker.js candidates_with_url.csv weights.json`
- Or via npm (use `--silent` and arg separator):
  - `npm run --silent train:ranker -- candidates_with_url.csv > weights.json`

4) Use the weights
- `test.js` auto‑loads `weights.json` (if present) and enables the reranker:
  - `options.contentDetection.reranker = { enabled: true, weights }`

Notes
- If no reranker is configured, the detector uses heuristic scoring only.
- You can merge CSVs from multiple runs: `npm run merge:csv` (writes `merged.csv`).
 - Tip: placing a `weights.json` in the project root will make `test.js` auto‑enable the reranker on the next run.

Update API docs with:

```
npm run docs
```

## Dependencies

- [Puppeteer](https://github.com/GoogleChrome/puppeteer/): High-level API to control Chrome or Chromium over the DevTools Protocol
- [puppeteer-extra](https://github.com/berstend/puppeteer-extra): Framework for puppeteer plugins
- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth): Plugin to evade detection
- [puppeteer-extra-plugin-user-data-dir](overrides/puppeteer-extra-plugin-user-data-dir): Persist and reuse Chromium user data
- [lighthouse](https://github.com/GoogleChrome/lighthouse): Automated auditing, performance metrics, and best practices
- [compromise](https://ghub.io/compromise): Natural language processing in the browser
- [retext](https://ghub.io/retext): Natural language processor powered by plugins
- [retext-pos](https://github.com/retextjs/retext-pos): Plugin to add part-of-speech (POS) tags
- [retext-keywords](https://ghub.io/retext-keywords): Keyword extraction with Retext
- [retext-spell](https://ghub.io/retext-spell): Spelling checker for retext
- [sentiment](https://ghub.io/sentiment): AFINN-based sentiment analysis for Node.js
- [jquery](https://ghub.io/jquery): JavaScript library for DOM operations
- [jsdom](https://ghub.io/jsdom): A JavaScript implementation of many web standards
- [lodash](https://ghub.io/lodash): Lodash modular utilities
- [absolutify](https://ghub.io/absolutify): Relative to Absolute URL Replacer
- [clean-html](https://ghub.io/clean-html): HTML cleaner and beautifier
- [dictionary-en-gb](https://ghub.io/dictionary-en-gb): English (United Kingdom) spelling dictionary in UTF-8
- [html-to-text](https://ghub.io/html-to-text): Advanced HTML to plain text converter
- [nlcst-to-string](https://ghub.io/nlcst-to-string): Stringify NLCST

## Dev Dependencies

- [eslint](https://ghub.io/eslint): An AST-based pattern checker for JavaScript
- [eslint-plugin-import](https://ghub.io/eslint-plugin-import): Import with sanity
- [eslint-plugin-json](https://ghub.io/eslint-plugin-json): Lint JSON files
- [eslint-plugin-n](https://ghub.io/eslint-plugin-n): Additional ESLint rules for Node.js
- [eslint-plugin-promise](https://ghub.io/eslint-plugin-promise): Enforce best practices for JavaScript promises

## License

This project is licensed under the GNU GENERAL PUBLIC LICENSE Version 3 - see the [LICENSE](LICENSE) file for details

## Notes






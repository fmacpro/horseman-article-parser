# Horseman Article Parser

Horseman is a focused article scraping module for the open web. It loads pages (dynamic or AMP), detects the main story body, and returns clean, structured content ready for downstream use. Alongside text and title, it includes in-article links, metadata, sentiment, keywords/keyphrases, named entities, optional spelling suggestions, site icon, and Lighthouse signals. It also copes with live blogs, applies simple per-domain tweaks (headers/cookies/goto), and uses Puppeteer + stealth to reduce blocking.

### Prerequisites

Node.js & NPM

### Install

```bash
npm install horseman-article-parser --save
```

### Usage

#### parseArticle(options, socket) ? <code>Object</code>

| Param   | Type                | Description         |
| ------- | ------------------- | ------------------- |
| options | <code>Object</code> | the options object  |
| socket  | <code>Object</code> | the optional socket |

**Returns**: <code>Object</code> - article parser results object

### Usage Example

```js
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
    // optional: promote selection to a parent container when
    // article paragraphs are split across sibling blocks
    fragment: {
      // require at least this many sibling parts containing paragraphs
      minParts: 2,
      // minimum text length per part
      minChildChars: 150,
      // minimum combined text across parts (set higher to be stricter)
      minCombinedChars: 400,
      // override parent link-density threshold (default uses max(maxLinkDensity, 0.65))
      // maxLinkDensity: 0.65
    },
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

### Quick Start (CLI)

Run quick tests and batches from this repo without writing code.

### Single URL test

Writes a detailed JSON to `tests/results/`.

```bash
TEST_TIMEOUT_MS=40000 node tests/test.js "https://www.cnn.com/business/live-news/fox-news-dominion-trial-04-18-23/index.html"
```

PowerShell:

```powershell
$env:TEST_TIMEOUT_MS=40000; node tests/test.js "https://www.cnn.com/business/live-news/fox-news-dominion-trial-04-18-23/index.html"
```

Parameters

- `TEST_TIMEOUT_MS`: maximum time (ms) for the parse. If omitted, the test uses its default.
- `<url>`: the article page to parse.

### Batch sampler (curated URLs, progress bar)

1) Fetch a fresh set of URLs:

```bash
node scripts/fetch-curated-urls.js 800
```

Parameters

- `800`: target number of URLs to collect into `scripts/data/urls.txt`.

2) Run a batch against unique hosts with a simple progress-only view. Progress and a final summary print to the console; JSON/CSV reports are saved under `tests/results/`.

Bash/Zsh:

```bash
UNIQUE_HOSTS=1 SAMPLE_PROGRESS_ONLY=1 SAMPLE_TICK_MS=1000 \
  node tests/sample-run.js 100 8 scripts/data/urls.txt 25000
```

PowerShell:

```powershell
$env:UNIQUE_HOSTS=1; $env:SAMPLE_PROGRESS_ONLY=1; $env:SAMPLE_TICK_MS=1000; \
  node tests/sample-run.js 100 8 scripts/data/urls.txt 25000
```

Parameters
- Env vars:
  - `UNIQUE_HOSTS=1`: ensure one URL per host (diverse sample)
  - `SAMPLE_PROGRESS_ONLY=1`: hide per-URL logs; show compact progress bar + summary
  - `SAMPLE_TICK_MS=1000`: progress update cadence in ms
- Positional args (for `tests/sample-run.js`):
  - `100`: max URLs to process
  - `8`: concurrency level
  - `scripts/data/urls.txt`: input list of URLs
  - `25000`: per-URL timeout in ms
- Outputs: JSON/CSV summaries under `tests/results/`.

### Training the Reranker (optional)

You can train a simple logistic-regression reranker to improve candidate selection.

1) Generate candidate features
- Single URL (appends candidates):
  - `node test.js`
- Batch (recommended):
  - `node scripts/batch-crawl.js scripts/data/urls.txt scripts/data/candidates_with_url.csv 0 200`
  - Adjust `start` and `limit` to process in slices (e.g., `200 200`, `400 200`, ...).
  Parameters

  - `scripts/data/urls.txt`: input list of URLs to crawl
  - `scripts/data/candidates_with_url.csv`: output CSV file for candidate features
  - `0`: start offset (row index) in the URLs file
  - `200`: limit (number of URLs to process in this run)
- The project dumps candidate features with URL by default (see `test.js`):
  - Header: `url,xpath,css_selector,text_length,punctuation_count,link_density,paragraph_count,has_semantic_container,boilerplate_penalty,direct_paragraph_count,direct_block_count,paragraph_to_block_ratio,average_paragraph_length,dom_depth,heading_children_count,aria_role_main,aria_role_negative,aria_hidden,image_alt_ratio,image_count,training_label,default_selected`
  - Up to `topN` unique-XPath rows per page (default 5)

2) Label the dataset
- Open `scripts/data/candidates_with_url.csv` in a spreadsheet/editor.
- For each URL group, set `label = 1` for the correct article body candidate (leave others as 0).
- Column meanings (subset):
  - `url`: source page
  - `xpath`: Chrome console snippet to select the container (e.g., `$x('...')[0]`)
  - `css_selector`: Chrome console snippet to select via CSS (e.g., `document.querySelector('...')`)
  - `text_length`: raw character length
  - `punctuation_count`: count of punctuation (.,!?,;:)
  - `link_density`: ratio of link text length to total text (0..1)
  - `paragraph_count`: count of `<p>` and `<br>` nodes under the container
  - `has_semantic_container`: 1 if within `article`/`main`/`role=main`/`itemtype*=Article`, else 0
  - `boilerplate_penalty`: number of boilerplate containers detected (nav/aside/comments/social/newsletter/consent), capped
  - `direct_paragraph_count`, `direct_block_count`, `paragraph_to_block_ratio`, `average_paragraph_length`, `dom_depth`, `heading_children_count`:
    direct-children structure features used by heuristics
  - `aria_role_main`, `aria_role_negative`, `aria_hidden`: accessibility signals
  - `image_alt_ratio`, `image_count`: image accessibility metrics
  - `training_label`: 1 for the true article candidate; 0 otherwise
  - `default_selected`: 1 if this candidate would be chosen by the default heuristic (no custom weights)

3) Train weights and export JSON
- Direct (avoids npm banner output):
  - `node scripts/train-reranker.js scripts/data/candidates_with_url.csv weights.json`
- Or via npm (use `--silent` and arg separator):
  - `npm run --silent train:ranker -- scripts/data/candidates_with_url.csv > weights.json`
  Parameters

  - `scripts/data/candidates_with_url.csv`: labeled candidates CSV (input)
  - `weights.json`: output weights file (JSON)
  Tips
  - `--` passes subsequent args to the underlying script
  - `> weights.json` redirects stdout to a file (Bash/PowerShell)

4) Use the weights
- `test.js` auto-loads `weights.json` (if present) and enables the reranker:
  - `options.contentDetection.reranker = { enabled: true, weights }`

Notes
- If no reranker is configured, the detector uses heuristic scoring only.
- You can merge CSVs from multiple runs: `npm run merge:csv` (writes `scripts/data/merged.csv`).
- Tip: placing a `weights.json` in the project root will make `test.js` auto-enable the reranker on the next run.

### Crawl Tweaks (config-driven)

Domain-specific navigation and header tweaks can be configured without changing code.

- Config file: `scripts/crawl-tweaks.json` (override via `CRAWL_TWEAKS_FILE=/path/to/config.json`).
- Two sections:
  - `rewrites`: URL rewrites applied before crawling (e.g., normalize feed wrappers).
  - `rules`: per-domain behavior overrides (disable interception, adjust `goto` wait/timeout, add headers, set retries).

Example:
```
{
  "rewrites": [
    { "type": "prefix", "from": "https://go.theregister.com/feed/www.theregister.com", "to": "https://www.theregister.com" }
  ],
  "rules": [
    {
      "match": "www.theregister.com",
      "type": "exact",
      "noInterception": true,
      "goto": { "waitUntil": "domcontentloaded", "timeout": 60000 },
      "headers": { "Referer": "https://go.theregister.com/" }
    },
    {
      "match": "bleepingcomputer.com",
      "type": "suffix",
      "noInterception": true,
      "goto": { "waitUntil": "domcontentloaded", "timeout": 90000 }
    },
    {
      "match": ".googleblog.com",
      "type": "suffix",
      "noInterception": true,
      "goto": { "waitUntil": "domcontentloaded", "timeout": 90000 },
      "headers": { "Referer": "https://developers.googleblog.com/" },
      "retries": 3
    }
  ]
}
```

Notes:
- Global defaults remain in code: `goto: { waitUntil: 'networkidle2', timeout: 60000 }` and `retries = 2`.
- Rule fields:
  - `match`: host to match (exact or suffix).
  - `type`: `exact` or `suffix`.
  - `noInterception`: disable request interception for this domain.
  - `goto`: override Puppeteer navigation options.
  - `headers`: merge extra HTTP headers.
  - `retries`: override retry attempts for this domain.

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


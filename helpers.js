import _ from 'lodash'

export function setDefaultOptions (options = {}) {
  const defaults = {
    enabled: [],
    puppeteer: {
      launch: {
        headless: true,
        defaultViewport: null,
        handleSIGINT: false
      },
      goto: { waitUntil: 'networkidle2' },
      setBypassCSP: true
    },
    striptags: [],
    blockedResourceTypes: [],
    skippedResources: [],
    title: {},
    nlp: { plugins: [] },
    contentDetection: {
      // fragmentation heuristic config (used to promote selection
      // to a higher-level container when paragraphs are split
      // across sibling blocks within ARTICLE/SECTION/MAIN)
      fragment: {
        minParts: 2,            // require at least this many sibling parts
        minChildChars: 150,     // minimum text length per part
        minCombinedChars: 400,  // minimum combined text across parts
        maxLinkDensity: null    // if set, override LD threshold for parent
      }
    }
  }
  return _.defaultsDeep({}, options, defaults)
}

export function capitalizeFirstLetter (string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

export function toTitleCase (str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  })
}

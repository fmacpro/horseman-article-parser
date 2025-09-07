import _ from 'lodash'

export function setDefaultOptions (options = {}) {
  const defaults = {
    enabled: [],
    // Hard cap for total parse duration (ms)
    timeoutMs: 10000,
    puppeteer: {
      launch: {
        headless: true,
        defaultViewport: null,
        handleSIGINT: false
      },
      // Use a quicker navigation condition with a short timeout
      goto: { waitUntil: 'domcontentloaded', timeout: 3500 },
      setBypassCSP: true
    },
    striptags: [],
    // Default: do not block resources here. Callers (tests/batch) decide.
    blockedResourceTypes: [],
    skippedResources: [],
    title: {},
    nlp: { plugins: [] },
    // Generic consent/overlay dismissal settings
    consent: {
      autoDismiss: true,
      selectors: [
        '#onetrust-accept-btn-handler',
        'button#onetrust-accept-btn-handler',
        'button[aria-label="Accept all"]',
        'button[aria-label*="Accept"]',
        'button[title="Accept"]',
        '#didomi-notice-agree-button',
        '.fc-accept-all',
        '.cc-allow',
        'button.cookie-accept',
        'button#cookie-accept',
        'button[aria-label="Agree"]'
      ],
      textPatterns: [
        'accept', 'agree', 'ok', 'got it', 'continue', 'allow all'
      ],
      waitAfterClickMs: 500,
      maxClicks: 3
    },
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

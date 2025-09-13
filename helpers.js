import _ from 'lodash'

export function setDefaultOptions (options = {}) {
  const defaults = {
    enabled: [],
    // Hard cap for total parse duration (ms)
    timeoutMs: 40000,
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
        'button[data-testid="accept-all"]',
        'button[aria-label*="Accept"]',
        'button[title="Accept"]',
        '#sp-cc-accept',
        '.osano-cm-accept-all',
        '.cc-accept-all',
        'button[aria-label*="consent" i]',
        'button[title*="consent" i]',
        '#didomi-notice-agree-button',
        '.fc-accept-all',
        '.cc-allow',
        'button.cookie-accept',
        'button#cookie-accept',
        'button[aria-label="Agree"]',
        'button[id*="bbccookies" i]',
        'button[title*="yes i\'m happy" i]',
        // Guardian/Sourcepoint common labels
        'button[title*="i\'m ok with that" i]',
        'button[aria-label*="i\'m ok with that" i]',
        'button[title*="yes, i\'m happy" i]'
      ],
      textPatterns: [
        'accept', 'accept all', 'accept and close', 'i accept', 'agree', 'i agree', 'yes i agree', "i'm ok with that", 'i am ok with that', 'ok', 'got it', 'continue', 'continue to site', 'allow all', 'consent', 'manage preferences', "yes i'm happy", 'yes i am happy'
      ],
      waitAfterClickMs: 500,
      maxClicks: 3,
      observerTimeoutMs: 5000
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
  const opts = _.defaultsDeep({}, options, defaults)
  if (!opts.enabled.includes('links')) opts.enabled.push('links')
  return opts
}

export function capitalizeFirstLetter (string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

export function stripPossessive (s, allWords = false) {
  const str = String(s).trim()
  if (!str) return str
  const words = str.split(/\s+/)
  const stripWord = (w) =>
    w
      .replace(/[’']s\b/i, '')
      .replace(/[^\p{L}\p{N}]+$/u, '')
  words[words.length - 1] = stripWord(words[words.length - 1])
  if (allWords && words.length > 1) {
    for (let i = 0; i < words.length - 1; i++) {
      words[i] = stripWord(words[i])
    }
  }
  return words.join(' ')
}

export function stripPunctuation (s) {
  return String(s || '')
    .replace(/[^\p{L}\p{N}\s'’]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function toTitleCase (str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  })
}

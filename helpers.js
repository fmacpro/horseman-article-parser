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
    nlp: { plugins: [] }
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


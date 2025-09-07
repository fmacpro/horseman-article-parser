import fs from 'fs'
import path from 'path'

function loadConfig(configPath) {
  try {
    const p = path.isAbsolute(configPath) ? configPath : path.resolve(configPath)
    if (fs.existsSync(p)) {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'))
      return json
    }
  } catch {}
  return null
}

function matchRule(host, rule) {
  const type = rule.type || 'exact'
  const m = rule.match || ''
  if (!m) return false
  if (type === 'exact') return host === m
  if (type === 'suffix') return host === m || host.endsWith(m)
  return false
}

export function applyDomainTweaks(url, options, config, context = {}) {
  const out = { retries: context.retries }
  let host = null
  try { host = new URL(url).hostname } catch { return out }

  const cfg = config || {}
  const rules = Array.isArray(cfg.rules) ? cfg.rules : []

  const rule = rules.find(r => matchRule(host, r))
  if (!rule) return out

  // Apply noInterception
  if (rule.noInterception === true) {
    options.noInterception = true
  }

  // Apply goto override
  if (rule.goto && typeof rule.goto === 'object') {
    options.puppeteer = options.puppeteer || {}
    options.puppeteer.goto = Object.assign(
      {},
      options.puppeteer.goto || {},
      rule.goto
    )
  }

  // Apply extra headers
  if (rule.headers && typeof rule.headers === 'object') {
    options.puppeteer = options.puppeteer || {}
    options.puppeteer.extraHTTPHeaders = Object.assign(
      {},
      options.puppeteer.extraHTTPHeaders || {},
      rule.headers
    )
  }

  // Retry overrides
  if (Number.isFinite(Number(rule.retries))) {
    out.retries = Number(rule.retries)
  }

  return out
}

export function loadTweaksConfig(configPath) {
  const envPath = process.env.CRAWL_TWEAKS_FILE
  const p = envPath || configPath || path.resolve('scripts/crawl-tweaks.json')
  return loadConfig(p)
}

// Optional URL rewrite step prior to applying per-domain rules
export function applyUrlRewrites(url, config) {
  const cfg = config || {}
  const rewrites = Array.isArray(cfg.rewrites) ? cfg.rewrites : []
  for (const r of rewrites) {
    if (!r || !r.type || !r.from || !r.to) continue
    if (r.type === 'prefix' && url.startsWith(r.from)) {
      return r.to + url.slice(r.from.length)
    }
  }
  return url
}

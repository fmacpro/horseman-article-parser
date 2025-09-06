// Content detector: structured-data aware + heuristic candidate scoring + optional ML reranker
import fs from 'fs'

const DEFAULT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '[itemtype*="Article"]',
  '.content, .article, .post, .story, .entry'
]

const NEGATIVE_CONTAINER = [
  'nav', 'aside', 'footer', 'form', 'header', 'noscript', 'template',
  '.comments', '.comment', '.related', '.recirculation', '.share', '.social', '.promo', '.sponsor', '.newsletter', '.consent'
]

function getText(el) {
  return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim()
}

function charCounts(text) {
  const len = text.length
  const punct = (text.match(/[.!?,;:]/g) || []).length
  return { len, punct }
}

function linkDensity(el) {
  const total = getText(el)
  const links = Array.from(el.querySelectorAll('a')).map(a => getText(a)).join(' ')
  const denom = total.length || 1
  return links.length / denom
}

function paragraphCount(el) {
  return el.querySelectorAll('p, br').length || 0
}

function containsSemantic(el) {
  if (!el) return 0
  if (['ARTICLE', 'MAIN'].includes(el.tagName)) return 1
  if (el.getAttribute('role') === 'main') return 1
  if (el.getAttribute('itemtype') && /Article/i.test(el.getAttribute('itemtype'))) return 1
  return 0
}

function penaltyForBoilerplate(el) {
  const sel = NEGATIVE_CONTAINER.join(',')
  const hits = el.querySelectorAll(sel).length
  return Math.min(3, hits) // cap penalty
}

function computeFeatures(el) {
  const text = getText(el)
  const { len, punct } = charCounts(text)
  const ld = linkDensity(el)
  const pc = paragraphCount(el)
  const sem = containsSemantic(el)
  const boiler = penaltyForBoilerplate(el)
  return { len, punct, ld, pc, sem, boiler }
}

function heuristicScore(f) {
  // Additive: favor length, punctuation, paragraphs, semantics; penalize link density and boilerplate
  const lengthScore = Math.log(1 + f.len) // grows slowly with length
  const punctScore = Math.min(f.punct / 10, 5)
  const paraScore = Math.min(f.pc / 5, 5)
  const semBonus = f.sem ? 2 : 0
  const linkPenalty = Math.min(f.ld * 10, 6)
  const boilerPenalty = f.boiler
  return lengthScore + punctScore + paraScore + semBonus - linkPenalty - boilerPenalty
}

function gatherCandidates(document) {
  const set = new Set()
  for (const sel of DEFAULT_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) set.add(el)
  }
  // add top-level content-ish divs
  const divs = Array.from(document.querySelectorAll('div'))
    .filter(d => getText(d).length > 400)
  for (const d of divs) set.add(d)
  return Array.from(set)
}

function stripBadContainers(el) {
  const clone = el.cloneNode(true)
  const sel = NEGATIVE_CONTAINER.join(',')
  for (const n of clone.querySelectorAll(sel)) {
    n.parentNode && n.parentNode.removeChild(n)
  }
  return clone
}

function getXPath(node) {
  try {
    if (!node || !node.ownerDocument) return ''
    const parts = []
    let n = node
    while (n && n.nodeType === 1 && n.tagName && n !== n.ownerDocument.documentElement) {
      const tag = n.tagName.toUpperCase()
      let index = 1
      let sib = n.previousSibling
      while (sib) {
        if (sib.nodeType === 1 && sib.tagName === n.tagName) index++
        sib = sib.previousSibling
      }
      parts.unshift(`${tag}[${index}]`)
      n = n.parentNode
    }
    if (n && n.nodeType === 1 && n.tagName) parts.unshift(n.tagName.toUpperCase())
    return '/' + parts.join('/')
  } catch {
    return ''
  }
}

function csvEscape(value) {
  if (value == null) return ''
  let s = String(value)
  if (s.includes('"')) s = s.replace(/"/g, '""')
  if (s.includes(',') || s.includes('"')) return '"' + s + '"'
  return s
}

function toVector(f) {
  // Basic scaling
  return [
    Math.log(1 + f.len),
    Math.min(f.punct / 10, 5),
    f.ld, // penalizing high
    Math.min(f.pc / 5, 5),
    f.sem ? 1 : 0,
    f.boiler
  ]
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)) }

function scoreWithWeights(v, w) {
  let z = w.bias || 0
  for (let i = 0; i < Math.min(v.length, (w.weights || []).length); i++) z += v[i] * w.weights[i]
  return sigmoid(z)
}

export function detectContent(document, options = {}, seeds = {}) {
  // Seeds
  let html = null
  if (seeds && typeof seeds.articleBody === 'string') {
    const body = seeds.articleBody.trim()
    if (body.length > 400) html = body
  }

  // Heuristic candidates
  const candidates = gatherCandidates(document)
  const scored = candidates.map(el => {
    const clean = stripBadContainers(el)
    const f = computeFeatures(clean)
    const hScore = heuristicScore(f)
    const vec = toVector(f)
    return { el, clean, f, hScore, vec }
  }).sort((a, b) => b.score - a.score)

  // Optional ML reranker hook (weights via options.contentDetection.reranker)
  let ordered = scored
  const rr = options.contentDetection && options.contentDetection.reranker
  if (rr && rr.enabled && rr.weights && Array.isArray(rr.weights.weights)) {
    ordered = scored
      .map(s => ({ ...s, mlScore: scoreWithWeights(s.vec, rr.weights) }))
      .sort((a, b) => (b.mlScore ?? 0) - (a.mlScore ?? 0))
  } else {
    ordered = scored.map(s => ({ ...s, score: s.hScore }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }

  const best = ordered[0]

  // Optional: dump candidate features for training a reranker
  try {
    const dump = options.contentDetection && options.contentDetection.debugDump
    if (dump && dump.path) {
      const path = dump.path
      const addUrl = !!dump.addUrl
      const wantHeader = addUrl ? 'url,xpath,len,punct,ld,pc,sem,boiler,label' : 'xpath,len,punct,ld,pc,sem,boiler,label'
      if (fs.existsSync(path)) {
        const first = fs.readFileSync(path, 'utf8').split(/\r?\n/)[0] || ''
        if (!first.includes('xpath')) {
          try { fs.renameSync(path, path + '.bak') } catch { /* ignore */ }
        }
      }
      if (!fs.existsSync(path)) {
        fs.writeFileSync(path, wantHeader + '\n', 'utf8')
      }
      const topN = Math.max(1, Math.min(dump.topN || 5, ordered.length))
      for (let i = 0; i < topN; i++) {
        const f = ordered[i].f
        const xp = getXPath(ordered[i].el)
        const base = [csvEscape(xp), f.len, f.punct, Number(f.ld.toFixed(6)), f.pc, f.sem ? 1 : 0, f.boiler, 0]
        const row = addUrl
          ? [csvEscape(options.url), ...base].join(',') + '\n'
          : base.join(',') + '\n'
        fs.appendFileSync(path, row, 'utf8')
      }
    }
  } catch {
    // ignore dump errors
  }
  if (!html && best && best.clean) {
    const minLen = (options.contentDetection && options.contentDetection.minLength) || 400
    const maxLD = (options.contentDetection && options.contentDetection.maxLinkDensity) || 0.5
    if (best.f.len >= minLen && best.f.ld <= maxLD) {
      html = best.clean.innerHTML
    } else if (scored[1]) {
      html = scored[1].clean.innerHTML
    }
  }

  return { title: seeds && seeds.headline ? seeds.headline : null, html }
}

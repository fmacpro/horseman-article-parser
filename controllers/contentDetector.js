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

function accessibilitySignals(el) {
  let roleMain = 0
  let roleNeg = 0
  let ariaHidden = 0
  let node = el
  const negRoles = new Set(['complementary', 'banner', 'navigation', 'contentinfo', 'search'])
  const posRoles = new Set(['main', 'article', 'region'])
  while (node && node.nodeType === 1) {
    const role = (node.getAttribute && node.getAttribute('role')) || ''
    if (posRoles.has(role)) roleMain = 1
    if (negRoles.has(role)) roleNeg = 1
    if ((node.hasAttribute && node.hasAttribute('hidden')) || (node.getAttribute && node.getAttribute('aria-hidden') === 'true')) {
      ariaHidden = 1
    }
    node = node.parentElement
  }
  return { roleMain, roleNeg, ariaHidden }
}

function imageAltRatio(el) {
  const imgs = Array.from(el.querySelectorAll('img'))
  const total = imgs.length
  if (total === 0) return { imgs: 0, imgAlt: 0, ratio: 1 }
  const withAlt = imgs.filter(i => {
    const alt = i.getAttribute('alt')
    return typeof alt === 'string' && alt.trim().length > 0
  }).length
  return { imgs: total, imgAlt: withAlt, ratio: withAlt / total }
}

function depthOf(el) {
  let d = 0
  let n = el
  while (n && n.parentElement) {
    d++
    if (n.parentElement.tagName === 'BODY' || n.parentElement.tagName === 'HTML') break
    n = n.parentElement
  }
  return d
}

function countDirect(el, tagName) {
  if (!el || !el.children) return 0
  const t = String(tagName || '').toUpperCase()
  return Array.from(el.children).filter(c => c.tagName === t).length
}

const BLOCK_TAGS = new Set(['P','H2','H3','H4','UL','OL','LI','FIGURE','BLOCKQUOTE','PRE','TABLE'])

function countDirectBlocks(el) {
  if (!el || !el.children) return 0
  return Array.from(el.children).filter(c => BLOCK_TAGS.has(c.tagName)).length
}

function averageDirectPTextLen(el) {
  if (!el || !el.children) return 0
  const ps = Array.from(el.children).filter(c => c.tagName === 'P')
  if (!ps.length) return 0
  const sum = ps.reduce((acc, p) => acc + getText(p).length, 0)
  return sum / ps.length
}

function headingChildrenCount(el) {
  if (!el || !el.children) return 0
  return Array.from(el.children).filter(c => c.tagName === 'H2' || c.tagName === 'H3' || c.tagName === 'H4').length
}

function computeFeatures(el) {
  const text = getText(el)
  const { len, punct } = charCounts(text)
  const ld = linkDensity(el)
  const pc = paragraphCount(el)
  const sem = containsSemantic(el)
  const boiler = penaltyForBoilerplate(el)
  const dp = countDirect(el, 'p')
  const db = countDirectBlocks(el)
  const dr = db > 0 ? dp / db : (dp > 0 ? 1 : 0)
  const avgP = averageDirectPTextLen(el)
  const depth = depthOf(el)
  const heads = headingChildrenCount(el)
  const a11y = accessibilitySignals(el)
  const iar = imageAltRatio(el)
  return { len, punct, ld, pc, sem, boiler, dp, db, dr, avgP, depth, heads, roleMain: a11y.roleMain, roleNeg: a11y.roleNeg, ariaHidden: a11y.ariaHidden, imgAltRatio: iar.ratio, imgCount: iar.imgs }
}

function heuristicScore(f) {
  // Additive: favor length, punctuation, paragraphs, semantics; penalize link density and boilerplate
  const lengthScore = Math.log(1 + f.len) // grows slowly with length
  const punctScore = Math.min(f.punct / 10, 5)
  const paraScore = Math.min(f.pc / 5, 5)
  const semBonus = f.sem ? 2 : 0
  const linkPenalty = Math.min(f.ld * 10, 6)
  const boilerPenalty = f.boiler
  // Direct-children centric signals
  const directPScore = Math.min(f.dp / 3, 6)
  const ratioScore = Math.min(f.dr * 6, 6)
  const avgPScore = Math.min(Math.log(1 + f.avgP), 4)
  const headingScore = Math.min(f.heads, 3) * 0.5
  const depthScore = Math.min(f.depth, 8) * 0.3 // small nudge towards nested nodes
  const wrapperPenalty = (f.dp === 0 && f.db > 0) ? 2 : 0
  const a11yScore = (f.roleMain ? 1.5 : 0) - (f.roleNeg ? 1 : 0) - (f.ariaHidden ? 3 : 0)
  const altScore = Math.min(f.imgAltRatio * 2, 2) // prefer images with alt text present

  return lengthScore + punctScore + paraScore + semBonus
    + directPScore + ratioScore + avgPScore + headingScore + depthScore + a11yScore + altScore
    - linkPenalty - boilerPenalty - wrapperPenalty
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

// Drill down within a container to find a more specific content node based on direct children
const CONTAINER_TAGS = new Set(['DIV','ARTICLE','SECTION','MAIN'])
function drillDownToContent(el, options = {}) {
  if (!el) return el
  const minLen = (options.contentDetection && options.contentDetection.minLength) || 400
  const maxLD = (options.contentDetection && options.contentDetection.maxLinkDensity) || 0.5

  const limitDepth = 5
  let best = { node: el, score: -Infinity }

  const queue = [{ node: el, depth: 0 }]
  while (queue.length) {
    const { node, depth } = queue.shift()
    if (!node || node.nodeType !== 1) continue
    if (!CONTAINER_TAGS.has(node.tagName)) continue

    const f = computeFeatures(node)
    // Emphasize direct paragraph structure for drill-down selection
    const lengthScore = Math.log(1 + f.len)
    const directPScore = Math.min(f.dp / 2, 8)
    const ratioScore = Math.min(f.dr * 8, 8)
    const avgPScore = Math.min(Math.log(1 + f.avgP), 5)
    const linkPenalty = Math.min(f.ld * 12, 8)
    const boilerPenalty = f.boiler
    const a11yScore = (f.roleMain ? 1.5 : 0) - (f.roleNeg ? 1 : 0) - (f.ariaHidden ? 3 : 0)
    const altScore = Math.min(f.imgAltRatio * 2, 2)
    const s = directPScore * 2 + ratioScore * 3 + avgPScore + lengthScore * 0.5 + a11yScore + altScore - linkPenalty - boilerPenalty

    if (f.len >= Math.min(minLen, 200) && f.ld <= Math.max(maxLD, 0.65)) {
      if (s > best.score) best = { node, score: s }
    }

    if (depth < limitDepth) {
      for (const child of Array.from(node.children)) {
        queue.push({ node: child, depth: depth + 1 })
      }
    }
  }
  return best.node || el
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

// Build a reasonably specific, unique CSS selector for an element
function cssEscapeIdent(s) {
  if (s == null) return ''
  return String(s).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

function getCssSelector(el) {
  try {
    if (!el || !el.ownerDocument) return ''
    const doc = el.ownerDocument
    // Prefer ID if unique
    if (el.id) {
      const idSel = `#${cssEscapeIdent(el.id)}`
      if (doc.querySelectorAll(idSel).length === 1) return idSel
    }

    const parts = []
    let node = el
    while (node && node.nodeType === 1) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        part += `#${cssEscapeIdent(node.id)}`
        parts.unshift(part)
        break
      }
      if (node.classList && node.classList.length) {
        const classes = Array.from(node.classList)
          .filter(Boolean)
          .slice(0, 2)
          .map(cssEscapeIdent)
        if (classes.length) part += '.' + classes.join('.')
      }
      const parent = node.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter(n => n.tagName === node.tagName)
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node) + 1
          part += `:nth-of-type(${idx})`
        }
      }
      parts.unshift(part)
      const trial = parts.join(' > ')
      try {
        if (doc.querySelectorAll(trial).length === 1) break
      } catch {
        // ignore selector errors and continue climbing
      }
      node = node.parentElement
      if (!node || node.tagName === 'HTML') break
    }
    return parts.join(' > ')
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
    f.boiler,
    // Extended features (safe: weights may ignore extras)
    Math.min(f.dp / 10, 1),
    Math.min(f.dr, 1),
    Math.min(Math.log(1 + f.avgP) / 5, 1),
    Math.min(f.depth / 10, 1),
    Math.min(f.heads / 6, 1),
    f.roleMain ? 1 : 0,
    f.roleNeg ? 1 : 0,
    f.ariaHidden ? 1 : 0,
    Math.min(f.imgAltRatio, 1),
    Math.min(f.imgCount / 50, 1)
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
  const prelim = candidates.map(el => {
    // First, try to find a more specific nested container
    const refined = drillDownToContent(el, options)
    const clean = stripBadContainers(refined)
    const f = computeFeatures(clean)
    const score = heuristicScore(f)
    const vec = toVector(f)
    return { el: refined, clean, f, score, vec }
  })

  // Optional ML reranker hook (weights via options.contentDetection.reranker)
  let ordered = prelim
  const rr = options.contentDetection && options.contentDetection.reranker
  if (rr && rr.enabled && rr.weights && Array.isArray(rr.weights.weights)) {
    ordered = prelim
      .map(s => ({ ...s, mlScore: scoreWithWeights(s.vec, rr.weights) }))
      .sort((a, b) => (b.mlScore ?? 0) - (a.mlScore ?? 0))
  } else {
    ordered = prelim.map(s => ({ ...s, score: s.score }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }

  const best = ordered[0]

  // Optional: dump candidate features for training a reranker
  try {
    const dump = options.contentDetection && options.contentDetection.debugDump
    if (dump && dump.path) {
      const path = dump.path
      const addUrl = !!dump.addUrl
      const wantHeader = addUrl
        ? 'url,xpath,len,punct,ld,pc,sem,boiler,dp,db,dr,avgP,depth,heads,roleMain,roleNeg,ariaHidden,imgAltRatio,imgCount,label'
        : 'xpath,len,punct,ld,pc,sem,boiler,dp,db,dr,avgP,depth,heads,roleMain,roleNeg,ariaHidden,imgAltRatio,imgCount,label'
      if (fs.existsSync(path)) {
        const first = fs.readFileSync(path, 'utf8').split(/\r?\n/)[0] || ''
        if (!first.includes('dp')) {
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
        const base = [
          csvEscape(xp),
          f.len,
          f.punct,
          Number(f.ld.toFixed(6)),
          f.pc,
          f.sem ? 1 : 0,
          f.boiler,
          f.dp,
          f.db,
          Number(f.dr.toFixed(6)),
          Number(f.avgP.toFixed(2)),
          f.depth,
          f.heads,
          f.roleMain ? 1 : 0,
          f.roleNeg ? 1 : 0,
          f.ariaHidden ? 1 : 0,
          Number(f.imgAltRatio.toFixed(3)),
          f.imgCount,
          0
        ]
        const row = addUrl
          ? [csvEscape(options.url), ...base].join(',') + '\n'
          : base.join(',') + '\n'
        fs.appendFileSync(path, row, 'utf8')
      }
    }
  } catch {
    // ignore dump errors
  }
  let selected = best
  if (!html && best && best.clean) {
    const minLen = (options.contentDetection && options.contentDetection.minLength) || 400
    const maxLD = (options.contentDetection && options.contentDetection.maxLinkDensity) || 0.5
    if (best.f.len >= minLen && best.f.ld <= maxLD) {
      html = best.clean.innerHTML
    } else if (ordered[1]) {
      html = ordered[1].clean.innerHTML
      selected = ordered[1]
    }
  }

  // Always attempt to provide a selector and XPath for the chosen container
  const selector = selected && selected.el ? getCssSelector(selected.el) : (document && document.body ? 'body' : null)
  const xpath = selected && selected.el ? getXPath(selected.el) : '/HTML/BODY'

  return { title: seeds && seeds.headline ? seeds.headline : null, html, selector, xpath }
}

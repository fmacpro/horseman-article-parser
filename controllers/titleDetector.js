// Title detection using structured data and meta tags, then fallback to H1/document.title

function getMeta(document, name, attr = 'content') {
  const byName = document.querySelector(`meta[name="${name}"]`)
  if (byName && byName.getAttribute(attr)) return byName.getAttribute(attr)
  const byProp = document.querySelector(`meta[property="${name}"]`)
  if (byProp && byProp.getAttribute(attr)) return byProp.getAttribute(attr)
  return null
}

function normalizeTitle(title) {
  if (!title) return null
  let t = String(title).replace(/(\r\n|\n|\r)/gm, ' ').replace(/\s+/g, ' ').trim()
  // remove common site suffixes after delimiters
  t = t.replace(/\s*[|\-–:·»]\s*[^|\-–:·»]{2,}\s*$/u, () => '')
  return t.trim() || null
}

export function detectTitle(document, seeds = {}) {
  // 1) structured data headline
  if (seeds && seeds.headline) {
    const t = normalizeTitle(seeds.headline)
    if (t) return t
  }
  // 2) OpenGraph/Twitter
  const og = getMeta(document, 'og:title')
  const tw = getMeta(document, 'twitter:title')
  let t = normalizeTitle(og || tw)
  if (t) return t
  // 3) first visible h1
  const h1 = document.querySelector('h1')
  t = normalizeTitle(h1 && h1.textContent)
  if (t) return t
  // 4) document.title
  t = normalizeTitle(document.title)
  return t
}

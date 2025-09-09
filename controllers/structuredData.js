// Extracts structured data from the DOM (JSON-LD Article|NewsArticle)
// Returns { headline, articleBody }

export function extractStructuredData(document) {
  const result = { headline: null, articleBody: null }

  const scripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const el of scripts) {
    let json
    try {
      const text = el.textContent || el.innerText || ''
      if (!text.trim()) continue
      json = JSON.parse(text)
    } catch {
      continue
    }

    const nodes = Array.isArray(json) ? json : [json]
    const flat = []
    for (const n of nodes) {
      if (n && typeof n === 'object') {
        if (Array.isArray(n['@graph'])) {
          for (const g of n['@graph']) flat.push(g)
        } else {
          flat.push(n)
        }
      }
    }

    for (const node of flat) {
      const type = node && node['@type']
      const types = Array.isArray(type) ? type : type ? [type] : []
      const isArticle = types.some(t => /Article$/i.test(String(t)))
      if (!isArticle) continue

      if (!result.headline && typeof node.headline === 'string' && node.headline.trim()) {
        result.headline = node.headline.trim()
      }
      if (!result.articleBody && typeof node.articleBody === 'string' && node.articleBody.trim()) {
        result.articleBody = node.articleBody
      }

      if (result.headline && result.articleBody) return result
    }
  }

  return result
}


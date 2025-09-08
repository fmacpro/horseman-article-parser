export function buildLiveBlogSummary (document) {
  try {
    const MAX_UPDATES = 40
    const items = []
    const seen = new Set()
    const getAncestor = (node) => {
      let n = node
      let depth = 0
      while (n && depth < 5) {
        if (['ARTICLE', 'SECTION', 'LI', 'DIV'].includes(n.tagName)) return n
        n = n.parentElement
        depth++
      }
      return node && node.parentElement ? node.parentElement : null
    }
    const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '')
    const times = Array.from(document.querySelectorAll('time, [datetime]')).slice(0, 200)
    for (const t of times) {
      const container = getAncestor(t)
      if (!container) continue
      if (seen.has(container)) continue
      seen.add(container)
      const ttl = container.querySelector('h1,h2,h3,h4,.headline,.title')
      const p = container.querySelector('p')
      const tt = text(t)
      const hd = text(ttl)
      const pv = text(p)
      const score = (tt ? 1 : 0) + (hd.length > 12 ? 1 : 0) + (pv.length > 60 ? 1 : 0)
      if (score >= 2) items.push({ time: tt, title: hd, body: pv })
      if (items.length >= MAX_UPDATES) break
    }
    if (items.length < 5) {
      const liveRoots = Array.from(document.querySelectorAll(
        '.live, .live-blog, .liveblog, .timeline, .live_updates, .updates, .update, .post, [role="article"]'
      )).slice(0, 200)
      for (const root of liveRoots) {
        if (!root) continue
        if (seen.has(root)) continue
        seen.add(root)
        const ttl = root.querySelector('h1,h2,h3,h4,.headline,.title')
        const p = root.querySelector('p')
        const hd = text(ttl)
        const pv = text(p)
        if (pv.length > 120 || (hd.length > 15 && pv.length > 60)) {
          items.push({ time: '', title: hd, body: pv })
        }
        if (items.length >= MAX_UPDATES) break
      }
    }
    if (items.length < 3) {
      try {
        const ampLists = Array.from(document.querySelectorAll('amp-live-list')).slice(0, 5)
        for (const lst of ampLists) {
          const candidates = Array.from(lst.querySelectorAll('[role="article"], article, li, .update, .post')).slice(0, 50)
          for (const c of candidates) {
            if (seen.has(c)) continue
            seen.add(c)
            const ttl = c.querySelector('h1,h2,h3,h4,.headline,.title')
            const p = c.querySelector('p')
            const timeEl = c.querySelector('time, [datetime]')
            const tt = text(timeEl)
            const hd = text(ttl)
            const pv = text(p)
            if (pv.length > 120 || (hd.length > 15 && pv.length > 60) || (tt && pv.length > 60)) {
              items.push({ time: tt, title: hd, body: pv })
            }
            if (items.length >= MAX_UPDATES) break
          }
          if (items.length >= MAX_UPDATES) break
        }
      } catch {}
    }
    const totalBody = items.reduce((acc, it) => acc + (it.body ? it.body.length : 0), 0)
    const enough = (items.length >= 3) || (items.length >= 2 && totalBody >= 500)
    if (enough) {
      const used = items.slice(0, 5)
      const html = ['<div class="live-summary">']
      let chars = 0
      for (const it of used) {
        try { if (it.body) chars += it.body.length } catch {}
        html.push('<div class="entry">')
        if (it.time) html.push(`<div class="time">${it.time}</div>`)
        if (it.title) html.push(`<div class="title">${it.title}</div>`)
        if (it.body) html.push(`<p>${it.body}</p>`)
        html.push('</div>')
      }
      html.push('</div>')
      return { ok: true, html: html.join(''), count: used.length, chars }
    }
  } catch {}
  return { ok: false }
}

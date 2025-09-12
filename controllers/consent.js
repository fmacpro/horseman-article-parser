import { sleep } from './async.js'

export async function autoDismissConsent (page, consentOptions = {}) {
  try {
    const selectors = Array.isArray(consentOptions.selectors) ? consentOptions.selectors : []
    const textPatterns = Array.isArray(consentOptions.textPatterns) ? consentOptions.textPatterns : []
    const maxClicks = Number.isFinite(consentOptions.maxClicks) ? consentOptions.maxClicks : 3
    const waitMs = Number.isFinite(consentOptions.waitAfterClickMs) ? consentOptions.waitAfterClickMs : 500
    const observerTimeoutMs = Number.isFinite(consentOptions.observerTimeoutMs)
      ? consentOptions.observerTimeoutMs
      : 5000

    let clicks = 0

    const clickSelectorsIn = async (ctx) => {
      for (const sel of selectors) {
        if (clicks >= maxClicks) break
        try {
          const el = await ctx.$(sel)
          if (el) {
            try {
              await el.evaluate(e => { try { e.scrollIntoView({ block: 'center' }) } catch {} })
            } catch {}
            await el.click({ delay: 20 })
            clicks++
            await sleep(waitMs)
          }
        } catch {}
      }
    }

    const clickByTextIn = async (frame) => {
      const patterns = textPatterns.map(s => String(s).toLowerCase())
      const remaining = maxClicks - clicks
      if (remaining <= 0 || patterns.length === 0) return
      try {
        const did = await frame.evaluate((patterns, remaining) => {
          const isVisible = (el) => {
            const rect = el.getBoundingClientRect()
            const style = window.getComputedStyle(el)
            return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
          }
          const isConsentContext = (el) => {
            let n = el
            const re = /(consent|cookie|privacy|gdpr|overlay|modal|dialog|banner|popup|message)/i
            while (n && n.nodeType === 1) {
              const id = n.id || ''
              const cls = (n.className && typeof n.className === 'string') ? n.className : ''
              const role = (n.getAttribute && n.getAttribute('role')) || ''
              if (re.test(id) || re.test(cls) || re.test(role)) return true
              try {
                const style = window.getComputedStyle(n)
                if (/(fixed|absolute|sticky)/i.test(style.position) && parseInt(style.zIndex || '0', 10) > 999) return true
              } catch {}
              n = n.parentElement
            }
            return false
          }
          const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div[role="button"]'))
          let count = 0
          for (const el of candidates) {
            if (count >= remaining) break
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase()
            if (!txt) continue
            if (patterns.some(p => txt.includes(p)) && isConsentContext(el)) {
              try { if (isVisible(el)) { el.click(); count++ } } catch {}
            }
          }
          return count
        }, patterns, remaining)
        clicks += Number(did) || 0
        if (did) await sleep(waitMs)
      } catch {}
    }

    // Perform an initial pass across current frames
    await clickSelectorsIn(page)
    for (const f of page.frames()) {
      if (clicks < maxClicks) await clickSelectorsIn(f)
    }
    for (const f of page.frames()) {
      if (clicks < maxClicks) await clickByTextIn(f)
    }

    // Guardian/sourcepoint CMP often injects late-loading iframes.
    // Poll briefly to catch and click newly added consent UIs.
    const pollUntil = Date.now() + Math.min(2000, observerTimeoutMs)
    while (Date.now() < pollUntil && clicks < maxClicks) {
      // Prefer frames that look like CMP/Sourcepoint/Guardian consent
      const frames = page.frames()
      const cmpFrames = frames.filter(f => {
        try {
          const url = String(f.url() || '')
          return /(sourcepoint|privacy|consent|sp_message|guardian)/i.test(url)
        } catch (_) { return false }
      })
      const order = cmpFrames.length ? cmpFrames : frames
      for (const f of order) {
        if (clicks >= maxClicks) break
        await clickSelectorsIn(f)
        await clickByTextIn(f)
      }
      if (clicks >= maxClicks) break
      await sleep(150)
    }

    if (clicks) {
      try {
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }).catch(() => {}),
          sleep(Math.min(waitMs, 1000))
        ])
      } catch {}
    }

    const articleZIndex = await page.evaluate(() => {
      const sel = 'article, main, [role="main"], .entry-content, .post-body, #postBody, .post-content, .article-content'
      const el = document.querySelector(sel)
      if (!el) return 0
      try {
        const style = window.getComputedStyle(el)
        const z = parseInt(style.zIndex || '0', 10)
        return Number.isFinite(z) ? z : 0
      } catch {}
      return 0
    })

    const removeOverlaysIn = async (ctx) => {
      try {
        return await ctx.evaluate((articleZIndex) => {
          let removed = 0
          const isOverlay = (el) => {
            try {
              const style = window.getComputedStyle(el)
              const z = parseInt(style.zIndex || '0', 10)
              if (!Number.isFinite(z)) return false
              if (z <= articleZIndex) return false
              if (!/(fixed|absolute|sticky)/i.test(style.position)) return false
              return true
            } catch {}
            return false
          }
          const re = /(consent|cookie|privacy|gdpr|overlay|modal|dialog|banner|popup|message|gu-cmp|site-message|sp_message)/i
          const nodes = Array.from(document.querySelectorAll('iframe, div, section, aside, header, footer'))
          for (const el of nodes) {
            const id = el.id || ''
            const cls = (el.className && typeof el.className === 'string') ? el.className : ''
            const role = (el.getAttribute && el.getAttribute('role')) || ''
            if (re.test(id) || re.test(cls) || re.test(role) || isOverlay(el)) {
              try { el.remove(); removed++ } catch { try { el.style.setProperty('display', 'none', 'important'); removed++ } catch {} }
            }
          }

          // Extra targeted cleanup for Guardian/Sourcepoint markup
          const hardSelectors = [
            'iframe[id^="sp_message_iframe"]',
            'div[id^="sp_message_container"]',
            '#sp_message_container_*, .sp_message_container',
            '.site-message--consent',
            '.site-message--banner',
            '#cmpOverlay',
            '#sp-cc, .fc-consent-root'
          ]
          for (const qs of hardSelectors) {
            try {
              const els = document.querySelectorAll(qs)
              els.forEach(e => { try { e.remove(); removed++ } catch { try { e.style.setProperty('display','none','important'); removed++ } catch {} } })
            } catch {}
          }
          return removed
        }, articleZIndex)
      } catch {}
      return 0
    }

    const removeOverlays = async () => {
      let total = 0
      total += await removeOverlaysIn(page)
      for (const f of page.frames()) { total += await removeOverlaysIn(f) }
      return total
    }

    try { await page.keyboard.press('Escape') } catch {}
    for (let i = 0; i < 5; i++) {
      const removed = await removeOverlays()
      if (!removed) break
      await sleep(50)
    }

    // Guard against overlays added after this call
    try {
      await page.evaluate((observerTimeoutMs, articleZIndex) => {
        const re = /(consent|cookie|privacy|gdpr|overlay|modal|dialog|banner|popup|message)/i
        const isOverlay = (el) => {
          try {
            const style = window.getComputedStyle(el)
            const z = parseInt(style.zIndex || '0', 10)
            if (!Number.isFinite(z)) return false
            if (z <= articleZIndex) return false
            if (!/(fixed|absolute|sticky)/i.test(style.position)) return false
            return true
          } catch {}
          return false
        }
        const observer = new window.MutationObserver(muts => {
          for (const m of muts) {
            for (const node of m.addedNodes) {
              if (!(node instanceof window.Element)) continue
              const id = node.id || ''
              const cls = typeof node.className === 'string' ? node.className : ''
              const role = node.getAttribute ? node.getAttribute('role') : ''
              if (re.test(id) || re.test(cls) || re.test(role) || isOverlay(node)) {
                try { node.remove() } catch {}
              }
            }
          }
        })
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true })
        setTimeout(() => observer.disconnect(), observerTimeoutMs)
      }, observerTimeoutMs, articleZIndex)
    } catch {}

    if (waitMs) await sleep(100)
  } catch {}
}

export async function removeConsentArtifacts (page) {
  try {
    const removeIn = async (ctx) => {
      try {
        return await ctx.evaluate(() => {
          let removed = 0
          const re = /(consent|cookie|privacy|gdpr)/i
          const nodes = Array.from(document.querySelectorAll('iframe, script'))
          for (const el of nodes) {
            const src = (el.getAttribute && el.getAttribute('src')) || ''
            const id = el.id || ''
            const cls = typeof el.className === 'string' ? el.className : ''
            if (re.test(src) || re.test(id) || re.test(cls)) {
              try { el.remove(); removed++ } catch { try { el.style.setProperty('display', 'none', 'important'); removed++ } catch {} }
            }
          }
          return removed
        })
      } catch {}
      return 0
    }

    let total = 0
    total += await removeIn(page)
    for (const f of page.frames()) { total += await removeIn(f) }
    return total
  } catch {
    return 0
  }
}

export async function removeAmpConsent (page) {
  try {
    const removeIn = async (ctx) => {
      try {
        return await ctx.evaluate(() => {
          let removed = 0
          const hard = [
            'amp-consent',
            'amp-user-notification',
            '.i-amphtml-consent-ui',
            '[amp-consent-blocking]',
            '.i-amphtml-overlay',
            '.i-amphtml-fixed-layer',
            '.i-amphtml-built i-amphtml-consent-ui',
            'iframe[id^="sp_message_iframe"]',
            'div[id^="sp_message_container"]'
          ]
          for (const qs of hard) {
            try {
              document.querySelectorAll(qs).forEach(el => { try { el.remove(); removed++ } catch { try { el.style.setProperty('display','none','important'); removed++ } catch {} } })
            } catch {}
          }
          // Add defensive CSS to hide remaining consent containers
          try {
            const style = document.createElement('style')
            style.setAttribute('data-consent-nuke', '1')
            style.textContent = `
              amp-consent, amp-user-notification, .i-amphtml-consent-ui,
              [amp-consent-blocking], .i-amphtml-overlay, .i-amphtml-fixed-layer,
              [class*="consent" i], [id*="consent" i], [class*="cookie" i], [id*="cookie" i],
              [class*="site-message" i], [id*="site-message" i],
              [class*="sp_message" i], [id*="sp_message" i],
              #cmpOverlay, .fc-consent-root {
                display: none !important; visibility: hidden !important; opacity: 0 !important;
              }
              html, body { overflow: auto !important; position: static !important; }
            `
            document.head.appendChild(style)
          } catch {}
          // Reset scroll locks commonly applied by AMP overlays
          try { document.documentElement.style.removeProperty('overflow') } catch {}
          try { document.body.style.removeProperty('overflow') } catch {}
          try { document.body.style.removeProperty('position') } catch {}
          try { document.body.style.removeProperty('top') } catch {}
          return removed
        })
      } catch {}
      return 0
    }
    let total = 0
    total += await removeIn(page)
    for (const f of page.frames()) { total += await removeIn(f) }
    return total
  } catch {
    return 0
  }
}

// As a last resort, strip any element covering the viewport center/top.
export async function clearViewportObstructions (page) {
  try {
    // Try multiple points: center and near top (to catch sticky headers/banners)
    const points = [
      { xFactor: 0.5, yFactor: 0.2 },
      { xFactor: 0.5, yFactor: 0.5 },
      { xFactor: 0.5, yFactor: 0.8 }
    ]
    for (const pt of points) {
      try {
        await page.evaluate(({ xFactor, yFactor }) => {
          const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
          const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
          const x = Math.floor(vw * xFactor)
          const y = Math.floor(vh * yFactor)
          let el = document.elementFromPoint(x, y)
          const limit = 10
          const re = /(consent|cookie|privacy|gdpr|overlay|modal|dialog|banner|popup|message|gu-cmp|site-message|sp_message)/i
          let steps = 0
          while (el && steps < limit) {
            const tag = (el.tagName || '').toLowerCase()
            if (tag === 'html' || tag === 'body') break
            const cls = typeof el.className === 'string' ? el.className : ''
            const id = el.id || ''
            try {
              const style = window.getComputedStyle(el)
              const isCover = /fixed|sticky|absolute/.test(style.position)
                && parseInt(style.zIndex || '0', 10) >= 100
                && (style.opacity === '' || parseFloat(style.opacity) > 0.01)
              if (re.test(id) || re.test(cls) || isCover) {
                try { el.remove() } catch { try { el.style.setProperty('display','none','important') } catch {} }
              }
            } catch {}
            el = el.parentElement
            steps++
          }
          try { document.body.style.removeProperty('overflow') } catch {}
        }, pt)
      } catch {}
    }
  } catch {}
}

export async function injectTcfApi (page, consentOptions = {}) {
  try {
    const tcString = typeof consentOptions.tcString === 'string' && consentOptions.tcString
      ? consentOptions.tcString
      : 'CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAAAAAAAAAAMAA'
    const gdprApplies = consentOptions.gdprApplies !== false

    await page.evaluateOnNewDocument((tcString, gdprApplies) => {
      const tcData = {
        tcString,
        tcfPolicyVersion: 2,
        cmpStatus: 'loaded',
        eventStatus: 'tcloaded',
        gdprApplies
      }
      const listeners = {}
      let nextId = 1
      window.__tcfapi = (cmd, version, callback) => {
        if (cmd === 'addEventListener') {
          const id = nextId++
          listeners[id] = callback
          callback(tcData, true)
          return id
        }
        if (cmd === 'removeEventListener') {
          delete listeners[version]
          callback(true)
          return
        }
        if (cmd === 'getTCData') {
          callback(tcData, true)
          return
        }
        callback(null, false)
      }
      window.__tcfapiLocator = {}
    }, tcString, gdprApplies)
  } catch {}
}

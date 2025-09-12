import { sleep } from './async.js'

export async function autoDismissConsent (page, consentOptions = {}) {
  try {
    const selectors = Array.isArray(consentOptions.selectors) ? consentOptions.selectors : []
    const textPatterns = Array.isArray(consentOptions.textPatterns) ? consentOptions.textPatterns : []
    const maxClicks = Number.isFinite(consentOptions.maxClicks) ? consentOptions.maxClicks : 3
    const waitMs = Number.isFinite(consentOptions.waitAfterClickMs) ? consentOptions.waitAfterClickMs : 500

    const frames = page.frames()
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

    await clickSelectorsIn(page)
    for (const f of frames) {
      if (clicks < maxClicks) await clickSelectorsIn(f)
    }

    for (const f of frames) {
      if (clicks < maxClicks) await clickByTextIn(f)
    }

    if (clicks) {
      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 })
      } catch {}
    }

    const removeOverlaysIn = async (ctx) => {
      try {
        return await ctx.evaluate(() => {
          let removed = 0
          const isOverlay = (el) => {
            try {
              const rect = el.getBoundingClientRect()
              const vw = window.innerWidth || document.documentElement.clientWidth
              const vh = window.innerHeight || document.documentElement.clientHeight
              if (rect.width < vw * 0.3 || rect.height < vh * 0.3) return false
              const style = window.getComputedStyle(el)
              if (!/(fixed|absolute|sticky)/i.test(style.position)) return false
              return parseInt(style.zIndex || '0', 10) > 999
            } catch {}
            return false
          }
          const re = /(consent|cookie|privacy|gdpr|overlay|modal|dialog|banner|popup|message)/i
          const nodes = Array.from(document.querySelectorAll('iframe, div, section, aside'))
          for (const el of nodes) {
            const id = el.id || ''
            const cls = (el.className && typeof el.className === 'string') ? el.className : ''
            const role = (el.getAttribute && el.getAttribute('role')) || ''
            if (re.test(id) || re.test(cls) || re.test(role) || isOverlay(el)) {
              try { el.remove(); removed++ } catch { try { el.style.setProperty('display', 'none', 'important'); removed++ } catch {} }
            }
          }
          return removed
        })
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
    for (let i = 0; i < 2; i++) {
      const removed = await removeOverlays()
      if (!removed) break
      await sleep(50)
    }
    if (waitMs) await sleep(100)
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

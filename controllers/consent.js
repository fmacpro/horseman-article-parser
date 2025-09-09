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
            const re = /(consent|cookie|privacy|gdpr)/i
            while (n && n.nodeType === 1) {
              const id = n.id || ''
              const cls = (n.className && typeof n.className === 'string') ? n.className : ''
              if (re.test(id) || re.test(cls)) return true
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

    try { await page.keyboard.press('Escape') } catch {}
    if (waitMs) await sleep(100)
  } catch {}
}

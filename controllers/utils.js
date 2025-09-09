import logger from './logger.js'

/**
 * Sanitize a data: URL by stripping scripts when JS is disabled
 * and return both sanitized HTML and URL.
 *
 * @param {string} rawUrl original data URL
 * @param {boolean} jsEnabled whether JavaScript is enabled
 * @returns {{html: string, sanitizedUrl: string}}
 */
export function sanitizeDataUrl (rawUrl, jsEnabled = true) {
  try {
    const idx = rawUrl.indexOf(',')
    const meta = rawUrl.slice(0, idx)
    const payload = rawUrl.slice(idx + 1)
    const html = meta.includes(';base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload)
    const sanitized = jsEnabled
      ? html
      : html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    const sanitizedUrl = 'data:text/html;base64,' + Buffer.from(sanitized).toString('base64')
    return { html: sanitized, sanitizedUrl }
  } catch (err) {
    logger.warn('sanitizeDataUrl failed', err)
    return { html: '', sanitizedUrl: rawUrl }
  }
}

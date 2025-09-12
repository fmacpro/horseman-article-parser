import logger from './logger.js'

/**
 * Safely await a promise and log any error.
 * @param {Promise} promise the promise to await
 * @param {string} [msg] optional message prefix
 * @returns {Promise<*>} resolved value or undefined on error
 */
export async function safeAwait (promise, msg = 'Async operation failed') {
  try {
    return await promise
  } catch (err) {
    try {
      const isTest = (typeof process !== 'undefined') && (
        (Array.isArray(process.execArgv) && process.execArgv.includes('--test')) ||
        (Array.isArray(process.argv) && process.argv.some(a => String(a).includes('--test'))) ||
        process.env.HORSEMAN_LOG_QUIET === '1'
      )
      if (msg !== 'Async operation failed' && !isTest) logger.warn(`${msg}: ${err.message}`)
    } catch {}
    return undefined
  }
}

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms time in milliseconds
 * @returns {Promise<void>}
 */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

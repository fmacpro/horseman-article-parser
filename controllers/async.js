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
    logger.warn(`${msg}: ${err.message}`)
    return undefined
  }
}

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms time in milliseconds
 * @returns {Promise<void>}
 */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

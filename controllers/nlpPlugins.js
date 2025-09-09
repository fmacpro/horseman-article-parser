import nlp from 'compromise'
import logger from './logger.js'

export function loadNlpPlugins (options) {
  const hints = { first: [], last: [] }
  if (!options?.nlp?.plugins?.length) return hints
  for (const plugin of options.nlp.plugins) {
    try { nlp.plugin(plugin) } catch (err) { logger.warn('nlp plugin load failed', err) }
    try {
      plugin(null, {
        addWords: (words = {}) => {
          for (const [w, tag] of Object.entries(words)) {
            if (/^first/i.test(tag)) hints.first.push(w)
            else if (/^last/i.test(tag)) hints.last.push(w)
          }
        }
      })
    } catch (err) { logger.warn('nlp plugin init failed', err) }
  }
  return hints
}

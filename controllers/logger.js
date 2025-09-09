import process from 'node:process'

export function createLogger({ quiet = false } = {}) {
  let isQuiet = quiet
  const wrap = fn => (...args) => {
    if (isQuiet) return
    try {
      if (process?.stdout && process.stdout.writable && !process.stdout.destroyed) {
        fn(...args)
      }
    } catch {}
  }
  return {
    setQuiet: q => { isQuiet = !!q },
    log: wrap(console.log),
    info: wrap(console.log),
    warn: wrap(console.warn),
    error: wrap(console.error)
  }
}

const defaultLogger = createLogger({
  quiet: process.execArgv.includes('--test') || process.env.HORSEMAN_LOG_QUIET === '1'
})

export default defaultLogger

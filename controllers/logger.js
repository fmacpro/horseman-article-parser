import process from 'node:process'

export function createLogger({ quiet = false } = {}) {
  const wrap = fn => (...args) => {
    if (quiet) return
    try {
      if (process?.stdout && process.stdout.writable && !process.stdout.destroyed) {
        fn(...args)
      }
    } catch {}
  }
  return {
    log: wrap(console.log),
    info: wrap(console.log),
    warn: wrap(console.warn),
    error: wrap(console.error)
  }
}

const defaultLogger = createLogger()
export default defaultLogger

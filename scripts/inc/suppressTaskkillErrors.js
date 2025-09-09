export function suppressTaskkillErrors() {
  if (process.platform !== 'win32') return
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, encoding, cb) => {
    const msg = typeof chunk === 'string' ? chunk : chunk.toString(encoding)
    if (/^ERROR: The process with PID \d+/.test(msg) || /^Reason: (The operation attempted is not supported|There is no running instance of the task)/i.test(msg)) {
      if (typeof cb === 'function') cb()
      return true
    }
    return originalWrite(chunk, encoding, cb)
  }
}

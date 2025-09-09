import fs from 'fs'
import path from 'path'
import { parseArgs } from 'node:util'
import logger, { createLogger } from '../controllers/logger.js'

export function readLines(file) {
  const text = fs.readFileSync(file, 'utf8')
  return text.split(/\r?\n/)
}

export function writeLines(file, lines) {
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

export function mergeCsv(outFile, inFiles, { quiet = process.execArgv.includes('--test') } = {}) {
  const log = quiet ? createLogger({ quiet: true }) : logger
  let header = null
  const rows = new Set()

  for (const f of inFiles) {
    const file = path.resolve(f)
    if (!fs.existsSync(file)) continue
    const lines = readLines(file)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (!header) {
        header = trimmed
        continue
      }
      if (trimmed === header) continue
      rows.add(trimmed)
    }
  }

  if (!header) {
    throw new Error('No header found in inputs; ensure at least one input CSV with a header row')
  }

  const outLines = [header, ...Array.from(rows)]
  writeLines(outFile, outLines)
  log.info(`Merged ${rows.size} unique rows into ${outFile}`)
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      quiet: { type: 'boolean', default: false }
    },
    allowPositionals: true
  })
  if (positionals.length < 2) {
    throw new Error('Usage: node scripts/merge-csv.js output.csv input1.csv [input2.csv ...]')
  }
  const [outFile, ...inFiles] = positionals

  mergeCsv(outFile, inFiles, { quiet: values.quiet })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { logger.error(err); throw err })
}


// Minimal logistic regression trainer for content detector reranker
// Usage: node scripts/train-reranker.js path/to/dataset.csv > weights.json
// CSV columns: len,punct,ld,pc,sem,boiler,label

import fs from 'fs'

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { cur += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { out.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
  }
  out.push(cur.trim())
  return out
}

function indexMap(headers, names) {
  const map = {}
  for (const [key, aliases] of Object.entries(names)) {
    let idx = -1
    for (const a of aliases) {
      idx = headers.indexOf(a)
      if (idx !== -1) break
    }
    map[key] = idx
  }
  return map
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const rows = []
  let headers = null
  let idx = null
  const nameAliases = {
    len: ['text_length', 'len'],
    punct: ['punctuation_count', 'punct'],
    ld: ['link_density', 'ld'],
    pc: ['paragraph_count', 'pc'],
    sem: ['has_semantic_container', 'sem'],
    boiler: ['boilerplate_penalty', 'boiler'],
    label: ['training_label', 'label']
  }

  for (const l of lines) {
    const fields = parseCsvLine(l)
    // Detect header (contains any known column name strings)
    if (!headers) {
      const lower = fields.map(s => s.toLowerCase())
      const looksHeader = lower.some(s => ['xpath','text_length','len','training_label','label'].includes(s))
      if (looksHeader) {
        headers = lower
        idx = indexMap(headers, nameAliases)
        continue
      }
    }

    if (headers && idx) {
      // Use named columns
      const get = (i) => {
        if (i < 0 || i >= fields.length) return NaN
        const n = Number(fields[i])
        return Number.isFinite(n) ? n : NaN
      }
      const v = [
        get(idx.len),
        get(idx.punct),
        get(idx.ld),
        get(idx.pc),
        get(idx.sem),
        get(idx.boiler),
        get(idx.label)
      ]
      if (v.every(n => Number.isFinite(n))) rows.push(v)
      continue
    }

    // Fallback: strip non-numerics and take first 7 numbers
    const nums = fields
      .map(x => Number(x))
      .filter(n => Number.isFinite(n))
    if (nums.length >= 7) rows.push(nums.slice(0, 7))
  }
  return rows
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)) }

function train(data, { lr = 0.01, epochs = 200, l2 = 0.0 } = {}) {
  const d = 6 // features
  let w = new Array(d).fill(0)
  let b = 0
  for (let e = 0; e < epochs; e++) {
    let dw = new Array(d).fill(0)
    let db = 0
    for (const row of data) {
      const x = row.slice(0, d)
      const y = row[d]
      let z = b
      for (let i = 0; i < d; i++) z += w[i] * x[i]
      const p = sigmoid(z)
      const diff = p - y
      for (let i = 0; i < d; i++) dw[i] += diff * x[i]
      db += diff
    }
    for (let i = 0; i < d; i++) {
      w[i] -= lr * (dw[i] / data.length + l2 * w[i])
    }
    b -= lr * (db / data.length)
  }
  return { weights: w, bias: b }
}

async function main() {
  const file = process.argv[2]
  const out = process.argv[3] || null
  if (!file) {
    throw new Error('Usage: node scripts/train-reranker.js dataset.csv > weights.json')
  }
  const csv = fs.readFileSync(file, 'utf8')
  const rows = parseCSV(csv)
  const weights = train(rows)
  const json = JSON.stringify(weights, null, 2)
  if (out) {
    fs.writeFileSync(out, json, 'utf8')
  } else {
    process.stdout.write(json)
  }
}

main().catch(err => { console.error(err); throw err })

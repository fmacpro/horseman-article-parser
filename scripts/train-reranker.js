// Minimal logistic regression trainer for content detector reranker
// Usage: node scripts/train-reranker.js path/to/dataset.csv > weights.json
// CSV columns: len,punct,ld,pc,sem,boiler,label

import fs from 'fs'

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const rows = []
  for (const l of lines) {
    // skip header if present
    if (/^\s*(url\s*,)?(xpath\s*,)?len\s*,/i.test(l)) continue
    const parts = l.split(',').map(x => x.trim())
    if (parts.length < 7) continue
    // Accept optional leading URL and/or XPATH columns
    let fields = parts
    while (fields.length > 7 && isNaN(Number(fields[0]))) {
      fields = fields.slice(1)
    }
    if (fields.length < 7) continue
    const nums = fields.map((x) => {
      const n = Number(x)
      return Number.isFinite(n) ? n : NaN
    })
    // ensure all numeric
    if (nums.some(n => !Number.isFinite(n))) continue
    rows.push(nums)
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

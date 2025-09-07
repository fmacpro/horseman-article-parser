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
    url: ['url'],
    xpath: ['xpath'],
    len: ['text_length', 'len'],
    punct: ['punctuation_count', 'punct'],
    ld: ['link_density', 'ld'],
    pc: ['paragraph_count', 'pc'],
    sem: ['has_semantic_container', 'sem'],
    boiler: ['boilerplate_penalty', 'boiler'],
    dp: ['direct_paragraph_count','dp'],
    db: ['direct_block_count','db'],
    dr: ['paragraph_to_block_ratio','dr'],
    avgP: ['average_paragraph_length','avgP'],
    depth: ['dom_depth','depth'],
    heads: ['heading_children_count','heads'],
    roleMain: ['aria_role_main','roleMain'],
    roleNeg: ['aria_role_negative','roleNeg'],
    ariaHidden: ['aria_hidden','ariaHidden'],
    imgAltRatio: ['image_alt_ratio','imgAltRatio'],
    imgCount: ['image_count','imgCount'],
    label: ['training_label', 'label']
  }

  for (const l of lines) {
    const fields = parseCsvLine(l)
    // Detect header (contains any known column name strings)
    if (!headers) {
      const lower = fields.map(s => s.toLowerCase())
      const looksHeader = lower.some(s => ['xpath','text_length','len','training_label','label','link_density'].includes(s))
      if (looksHeader) {
        headers = lower
        idx = indexMap(headers, nameAliases)
        continue
      }
    }

    if (headers && idx) {
      // Build vector matching detectContent.toVector scaling (16 dims)
      const num = (i) => (i >= 0 && i < fields.length) ? Number(fields[i]) : NaN
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
      const len = num(idx.len)
      const punct = num(idx.punct)
      const ld = num(idx.ld)
      const pc = num(idx.pc)
      const sem = num(idx.sem)
      const boiler = num(idx.boiler)
      const dp = num(idx.dp)
      const db = num(idx.db)
      const dr = num(idx.dr)
      const avgP = num(idx.avgP)
      const depth = num(idx.depth)
      const heads = num(idx.heads)
      const roleMain = num(idx.roleMain)
      const roleNeg = num(idx.roleNeg)
      const ariaHidden = num(idx.ariaHidden)
      const imgAltRatio = num(idx.imgAltRatio)
      const imgCount = num(idx.imgCount)
      const label = num(idx.label)

      const hasAll = [len, punct, ld, pc, sem, boiler, dp, db, dr, avgP, depth, heads, roleMain, roleNeg, ariaHidden, imgAltRatio, imgCount, label]
        .every(n => Number.isFinite(n))
      if (!hasAll) continue

      const vec = [
        Math.log(1 + len),
        clamp(punct / 10, 0, 5),
        ld,
        clamp(pc / 5, 0, 5),
        sem ? 1 : 0,
        boiler,
        clamp(dp / 10, 0, 1),
        clamp(dr, 0, 1),
        clamp(Math.log(1 + avgP) / 5, 0, 1),
        clamp(depth / 10, 0, 1),
        clamp(heads / 6, 0, 1),
        roleMain ? 1 : 0,
        roleNeg ? 1 : 0,
        ariaHidden ? 1 : 0,
        clamp(imgAltRatio, 0, 1),
        clamp(imgCount / 50, 0, 1)
      ]
      rows.push({ x: vec, y: label })
      continue
    }

    // Fallback: strip non-numerics and take first 7 numbers
    const nums = fields
      .map(x => Number(x))
      .filter(n => Number.isFinite(n))
    if (nums.length >= 17) {
      rows.push({ x: nums.slice(0, 16), y: nums[16] })
    }
  }
  return rows
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)) }

function train(data, { lr = 0.05, epochs = 250, l2 = 0.001 } = {}) {
  if (!data.length) return { weights: [], bias: 0 }
  const d = data[0].x.length
  let w = new Array(d).fill(0)
  let b = 0
  for (let e = 0; e < epochs; e++) {
    let dw = new Array(d).fill(0)
    let db = 0
    for (const row of data) {
      const x = row.x
      const y = row.y
      let z = b
      for (let i = 0; i < d; i++) z += w[i] * x[i]
      const p = sigmoid(z)
      const diff = p - y
      for (let i = 0; i < d; i++) dw[i] += diff * x[i]
      db += diff
    }
    const n = data.length
    for (let i = 0; i < d; i++) {
      w[i] -= lr * ((dw[i] / n) + l2 * w[i])
    }
    b -= lr * (db / n)
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

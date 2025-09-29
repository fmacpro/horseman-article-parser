import { JSDOM } from 'jsdom'

// Extracts structured data from the DOM (JSON-LD Article|NewsArticle)
// Returns { headline, articleBody, articles, body }

const ARTICLE_TYPE_PATTERN = /Article$/i

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function pickString(value, options = {}) {
  const preserveWhitespace = options.preserveWhitespace === true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    return preserveWhitespace ? value : trimmed
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const res = pickString(item, options)
      if (res) return res
    }
  }
  return null
}

function cloneNode(node) {
  try {
    return JSON.parse(JSON.stringify(node))
  } catch {
    return null
  }
}

function normalizeWhitespace(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function parseTable(table) {
  if (!table) return null
  const caption = pickString(table.querySelector('caption')?.textContent)
  const allRows = Array.from(table.querySelectorAll('tr'))
  if (!allRows.length) return null

  let headerRowIndex = -1
  let headerRow = null
  let headerOverride = null

  if (table.tHead) {
    const theadRows = Array.from(table.tHead.querySelectorAll('tr')).filter(r => r.cells.length)
    if (theadRows.length) {
      headerRow = theadRows[theadRows.length - 1]
      headerRowIndex = allRows.indexOf(headerRow)
    }
  }

  if (!headerRow) {
    const candidateIndex = allRows.findIndex(row => Array.from(row.cells).some(cell => cell.tagName === 'TH'))
    if (candidateIndex !== -1) {
      headerRowIndex = candidateIndex
      headerRow = allRows[candidateIndex]
    }
  }

  if (!headerRow && allRows.length) {
    const firstCells = Array.from(allRows[0].cells)
    const derived = firstCells.map(cell => normalizeWhitespace(cell.textContent || ''))
    if (derived.some(Boolean)) {
      headerRow = allRows[0]
      headerRowIndex = 0
      headerOverride = derived.map(text => text || null)
    }
  }

  const headerCells = headerRow ? Array.from(headerRow.cells) : []
  let headers
  if (headerOverride) {
    headers = headerOverride
  } else {
    headers = headerCells.map(cell => normalizeWhitespace(cell.textContent || '')).map(text => text || null)
  }

  const dataRows = []
  allRows.forEach((row, idx) => {
    if (idx === headerRowIndex) return
    const cells = Array.from(row.cells).map(cell => ({
      text: normalizeWhitespace(cell.textContent || ''),
      colspan: Number(cell.getAttribute('colspan')) || cell.colSpan || 1,
      rowspan: Number(cell.getAttribute('rowspan')) || cell.rowSpan || 1,
    }))
    if (!cells.length) return
    const rowEntry = { cells }
    if (headers.length) {
      const expanded = []
      for (const cell of cells) {
        const span = Number(cell.colspan) || 1
        for (let i = 0; i < span; i++) expanded.push(cell.text)
      }
      const object = {}
      let used = false
      headers.forEach((header, colIdx) => {
        if (!header) return
        const value = expanded[colIdx] ?? ''
        object[header] = value
        if (value) used = true
      })
      if (used || Object.keys(object).length) rowEntry.object = object
    }
    dataRows.push(rowEntry)
  })

  const columnCount = headers.length || dataRows.reduce((max, row) => {
    const cols = row.cells.reduce((acc, cell) => acc + (Number(cell.colspan) || 1), 0)
    return Math.max(max, cols)
  }, 0)

  return {
    type: 'table',
    caption: caption || null,
    headers,
    rows: dataRows,
    rowCount: dataRows.length,
    columnCount,
    html: table.outerHTML
  }
}

function parseDefinitionList(dl) {
  if (!dl) return null
  const items = []
  let current = null
  const children = Array.from(dl.children)
  for (const child of children) {
    if (child.tagName === 'DT') {
      const term = normalizeWhitespace(child.textContent || '')
      if (!term) continue
      current = { term, descriptions: [] }
      items.push(current)
    } else if (child.tagName === 'DD') {
      const description = normalizeWhitespace(child.textContent || '')
      if (!description) continue
      if (!current) {
        current = { term: null, descriptions: [] }
        items.push(current)
      }
      current.descriptions.push(description)
    }
  }
  if (!items.length) return null
  return {
    type: 'definitionList',
    items,
    html: dl.outerHTML
  }
}

function parseFigure(figure) {
  if (!figure) return null
  const caption = pickString(figure.querySelector('figcaption')?.textContent)
  const images = Array.from(figure.querySelectorAll('img')).map(img => ({
    src: img.getAttribute('src') || null,
    alt: normalizeWhitespace(img.getAttribute('alt') || ''),
    title: normalizeWhitespace(img.getAttribute('title') || ''),
  }))
  const nestedTables = Array.from(figure.querySelectorAll('table')).map(parseTable).filter(Boolean)
  return {
    type: 'figure',
    caption: caption || null,
    images,
    tables: nestedTables,
    text: normalizeWhitespace(figure.textContent || ''),
    html: figure.outerHTML
  }
}

export function extractBodyStructuredData(html) {
  const result = { tables: [], definitionLists: [], figures: [] }
  if (typeof html !== 'string' || !html.trim()) return result
  let dom
  try {
    dom = new JSDOM(`<body>${html}</body>`)
  } catch {
    return result
  }
  const document = dom?.window?.document
  if (!document) return result

  result.tables = Array.from(document.querySelectorAll('table')).map(parseTable).filter(Boolean)
  result.definitionLists = Array.from(document.querySelectorAll('dl')).map(parseDefinitionList).filter(Boolean)
  result.figures = Array.from(document.querySelectorAll('figure')).map(parseFigure).filter(Boolean)

  return result
}

export function extractStructuredData(document) {
  const bodyHtml = document && document.body ? document.body.innerHTML : ''
  const result = { headline: null, articleBody: null, articles: [], body: extractBodyStructuredData(bodyHtml) }
  if (!document || typeof document.querySelectorAll !== 'function') return result

  const scripts = document.querySelectorAll('script[type="application/ld+json"]')
  const seenArticles = new Set()

  for (const el of scripts) {
    let json
    try {
      const text = el.textContent || el.innerText || ''
      if (!text.trim()) continue
      json = JSON.parse(text)
    } catch {
      continue
    }

    const visitQueue = [...toArray(json)]
    const visited = new Set()

    while (visitQueue.length) {
      const node = visitQueue.shift()
      if (!node || typeof node !== 'object') continue
      if (visited.has(node)) continue
      visited.add(node)

      const types = toArray(node['@type']).map(t => String(t || ''))
      const isArticle = types.some(t => ARTICLE_TYPE_PATTERN.test(t))

      if (isArticle) {
        if (!result.headline) {
          const headline = pickString(node.headline)
          if (headline) result.headline = headline
        }
        if (!result.articleBody) {
          const articleBody = pickString(node.articleBody, { preserveWhitespace: true })
          if (articleBody) result.articleBody = articleBody
        }

        const cloned = cloneNode(node)
        if (cloned) {
          const key = JSON.stringify(cloned)
          if (!seenArticles.has(key)) {
            result.articles.push(cloned)
            seenArticles.add(key)
          }
        }
      }

      for (const value of Object.values(node)) {
        if (!value || typeof value !== 'object') continue
        if (Array.isArray(value)) {
          for (const item of value) visitQueue.push(item)
        } else {
          visitQueue.push(value)
        }
      }
    }
  }

  return result
}

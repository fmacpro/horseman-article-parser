import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mergeCsv } from '../scripts/merge-csv.js'

test('mergeCsv merges unique rows across files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-csv-'))
  const outFile = path.join(dir, 'out.csv')
  const input1 = path.join(dir, 'in1.csv')
  const input2 = path.join(dir, 'in2.csv')

  fs.writeFileSync(input1, 'header\nrow1\nrow2\n')
  fs.writeFileSync(input2, 'header\nrow2\nrow3\n')

  mergeCsv(outFile, [input1, input2])

  const result = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/)
  assert.deepEqual(result, ['header', 'row1', 'row2', 'row3'])

  fs.rmSync(dir, { recursive: true, force: true })
})

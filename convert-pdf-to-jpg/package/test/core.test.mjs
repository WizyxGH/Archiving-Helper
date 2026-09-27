import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createIsu, loadCore, formatOutputName, DEFAULT_OUTPUT_NAME_TEMPLATE } from '../src/index.mjs'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

test('formatOutputName resolves standard template variables', () => {
  const result = formatOutputName('{name}_{page:03d}', {
    name: 'Mickey',
    page: 7,
    total: 48,
    date: new Date('2026-09-27T12:00:00Z'),
  })
  assert.equal(result, 'Mickey_007.jpg')
})

test('formatOutputName resolves date and total variables', () => {
  const date = new Date(2026, 8, 27) // September 27, 2026
  const result = formatOutputName('{name}_{year}-{month}-{day}_p{page:02d}-of-{total}', {
    name: 'Duck',
    page: 3,
    total: 32,
    date,
  })
  assert.equal(result, 'Duck_2026-09-27_p03-of-32.jpg')
})

test('formatOutputName applies default template when used', () => {
  const result = formatOutputName(DEFAULT_OUTPUT_NAME_TEMPLATE, {
    name: 'Comic',
    page: 12,
    total: 100,
  })
  assert.equal(result, 'Comic_0012.jpg')
})

test('createIsu creates valid adapter with defaults', async () => {
  const isu = createIsu({
    async inflate(bytes) { return bytes },
    async bytesAt(file, from, len) { return new Uint8Array(len) },
  })

  assert.equal(typeof isu.stage, 'function')
  assert.equal(typeof isu.bytesAt, 'function')
  assert.equal(typeof isu.inflate, 'function')
  assert.equal(typeof isu.fileFrom, 'function')
  assert.equal(typeof isu.exifOrientation, 'function')

  assert.equal(isu.exifOrientation(new Uint8Array(10), null, 0, 10), 1)

  const f = await isu.fileFrom({ size: 100 }, 0, 50, 'test.jpg', 'image/jpeg')
  assert.equal(f.name, 'test.jpg')
  assert.equal(f.size, 50)
})

test('loadCore enriches isu adapter with pdfImages and jpegCrop', () => {
  const isu = createIsu({
    async inflate(bytes) { return bytes },
    async bytesAt(file, from, len) { return new Uint8Array(len) },
  })

  loadCore(
    isu,
    (filename) => readFileSync(path.join(srcDir, filename), 'utf8'),
    (code, filename) => vm.runInThisContext(code, { filename }),
  )

  assert.equal(typeof isu.pdfImages, 'function')
  assert.equal(typeof isu.jpegCrop, 'object')
  assert.equal(typeof isu.jpegCrop.parse, 'function')
  assert.equal(typeof isu.jpegCrop.crop, 'function')
  assert.equal(typeof isu.jpegCrop.optimise, 'function')
  assert.equal(typeof isu.jpegCrop.grid, 'function')
  assert.equal(typeof isu.jpegCrop.snap, 'function')
})

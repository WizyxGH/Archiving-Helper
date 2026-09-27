import { inflateRawSync, inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { parentPort } from 'node:worker_threads'

import { createIsu, loadCore } from './package/src/index.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageSrcDir = path.join(scriptDir, 'package', 'src')

const isu = createIsu({
  async inflate(bytes) {
    try {
      return new Uint8Array(inflateSync(bytes))
    } catch (zlibError) {
      try {
        return new Uint8Array(inflateRawSync(bytes))
      } catch {
        throw zlibError
      }
    }
  },
  async bytesAt(file, from, len) {
    return new Uint8Array(await file.slice(from, from + len).arrayBuffer())
  },
})

loadCore(
  isu,
  (filename) => readFileSync(path.join(packageSrcDir, filename), 'utf8'),
  (code, filename) => vm.runInThisContext(code, { filename }),
)

function visibleCrop(bytes, visible) {
  const grid = isu.jpegCrop.grid(bytes)
  const snap = (value, step, max) =>
    Math.max(0, Math.min(Math.round(value / step) * step, Math.floor((max - 1) / step) * step))
  const x = snap(visible.x, grid.w, visible.imageW)
  const y = snap(visible.y, grid.h, visible.imageH)
  const w = Math.min(visible.imageW, Math.round(visible.x + visible.w)) - x
  const h = Math.min(visible.imageH, Math.round(visible.y + visible.h)) - y
  if (w <= 0 || h <= 0) throw new Error('The visible crop area of the PDF is invalid.')
  return isu.jpegCrop.crop(bytes, { x, y, w, h }).bytes
}

parentPort.on('message', ({ bytes, visible }) => {
  try {
    const source = new Uint8Array(bytes)
    const output = visible
      ? visibleCrop(source, visible)
      : isu.jpegCrop.optimise(source) || source
    const transferable = output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
      ? output.buffer
      : output.slice().buffer
    parentPort.postMessage({ bytes: transferable }, [transferable])
  } catch (error) {
    parentPort.postMessage({ error: error.message || String(error) })
  }
})

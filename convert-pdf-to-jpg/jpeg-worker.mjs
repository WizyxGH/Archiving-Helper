import { inflateRawSync, inflateSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parentPort } from 'node:worker_threads'

const scriptDir = new URL('.', import.meta.url)
const isu = {
  stage() {},
  async bytesAt(file, from, len) {
    return new Uint8Array(await file.slice(from, from + len).arrayBuffer())
  },
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
  exifOrientation(bytes, view, from, to) {
    if (to - from < 14 || view.getUint32(from) !== 0x45786966 || view.getUint16(from + 4) !== 0) return 1
    const tiff = from + 6
    const littleEndian = view.getUint16(tiff) === 0x4949
    const u16 = (offset) => view.getUint16(offset, littleEndian)
    const u32 = (offset) => view.getUint32(offset, littleEndian)
    if (u16(tiff + 2) !== 42) return 1
    const ifd = tiff + u32(tiff + 4)
    if (ifd + 2 > to) return 1
    for (let i = 0, count = u16(ifd); i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (entry + 12 > to) break
      if (u16(entry) === 0x0112) {
        const orientation = u16(entry + 8)
        return orientation >= 1 && orientation <= 8 ? orientation : 1
      }
    }
    return 1
  },
}

globalThis.window = { ISU: isu }
for (const file of ['jpeg-core.js', 'pdf-core.js']) {
  vm.runInThisContext(await readFile(new URL(file, scriptDir), 'utf8'), { filename: file })
}

function visibleCrop(bytes, visible) {
  const grid = isu.jpegCrop.grid(bytes)
  const snap = (value, step, max) =>
    Math.max(0, Math.min(Math.round(value / step) * step, Math.floor((max - 1) / step) * step))
  const x = snap(visible.x, grid.w, visible.imageW)
  const y = snap(visible.y, grid.h, visible.imageH)
  const w = Math.min(visible.imageW, Math.round(visible.x + visible.w)) - x
  const h = Math.min(visible.imageH, Math.round(visible.y + visible.h)) - y
  if (w <= 0 || h <= 0) throw new Error('La zone visible du PDF est invalide.')
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

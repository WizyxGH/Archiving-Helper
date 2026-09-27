#!/usr/bin/env node
import { inflateRawSync, inflateSync } from 'node:zlib'
import { open, readFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const isu = {
  stage() {},
  async bytesAt(file, from, len) {
    return new Uint8Array(await file.slice(from, from + len).arrayBuffer())
  },
  async fileFrom(file, from, len, name, type) {
    return { file, from, len, name, type, size: len }
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
  vm.runInThisContext(await readFile(path.join(scriptDir, file), 'utf8'), { filename: file })
}

function usage() {
  console.error(
    'Usage: node pdf-to-jpg.mjs <file.pdf> [--output-dir <directory>] [--workers <count>]\n' +
    'Extracts and losslessly optimizes single-JPEG pages without rendering the PDF.',
  )
}

function parseArgs(args) {
  let input = null
  let outputDir = null
  let workers = Math.min(4, Math.max(1, availableParallelism() - 1))
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      usage()
      return null
    } else if (args[i] === '--output-dir') {
      if (outputDir || !args[i + 1]) throw new Error('--output-dir requires one directory')
      outputDir = args[++i]
    } else if (args[i] === '--workers') {
      const count = Number(args[++i])
      if (!Number.isInteger(count) || count < 1 || count > 32) {
        throw new Error('--workers must be an integer between 1 and 32')
      }
      workers = count
    } else if (args[i].startsWith('-')) {
      throw new Error(`Unknown option: ${args[i]}`)
    } else if (input) {
      throw new Error('Provide one PDF at a time')
    } else {
      input = args[i]
    }
  }
  if (!input) {
    usage()
    process.exitCode = 2
    return null
  }
  return { input: path.resolve(input), outputDir: outputDir && path.resolve(outputDir), workers }
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

function optimizeInWorker(worker, bytes, visible) {
  const transferable = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    const onMessage = (message) => {
      cleanup()
      if (message.error) reject(new Error(message.error))
      else resolve(new Uint8Array(message.bytes))
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`Le worker JPEG s’est arrêté (code ${code}).`))
    }
    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    worker.postMessage({ bytes: transferable, visible }, [transferable])
  })
}

async function convert(input, requestedOutputDir, workerLimit) {
  const outputDir = requestedOutputDir ||
    path.join(path.dirname(input), `${path.parse(input).name}_jpg`)
  try {
    await stat(outputDir)
    throw new Error(`Le dossier de sortie existe déjà : ${outputDir}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const handle = await open(input, 'r')
  const inputStat = await handle.stat()
  const file = {
    name: path.basename(input),
    size: inputStat.size,
    slice(start, end) {
      const length = Math.max(0, Math.min(end, inputStat.size) - start)
      return {
        async arrayBuffer() {
          const bytes = Buffer.allocUnsafe(length)
          let read = 0
          while (read < length) {
            const result = await handle.read(bytes, read, length - read, start + read)
            if (!result.bytesRead) throw new Error('Lecture incomplète du PDF.')
            read += result.bytesRead
          }
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        },
      }
    },
  }
  const parent = path.dirname(outputDir)
  let tempDir
  let totalInputBytes = 0
  let totalOutputBytes = 0
  let result
  let workers = []

  try {
    result = await isu.pdfImages(file)
    if (result.skipped.length) {
      throw new Error(
        `${result.skipped.length} page(s) ne sont pas une image JPEG unique ` +
        `(${result.skipped.slice(0, 8).join(', ')}${result.skipped.length > 8 ? ', …' : ''}). ` +
        'Aucune sortie partielle n’a été conservée.',
      )
    }
    await mkdir(parent, { recursive: true })
    tempDir = await mkdtemp(path.join(parent, `.${path.basename(outputDir)}.tmp-`))
    const workerCount = result.files.length >= 4
      ? Math.min(workerLimit, result.files.length)
      : 1
    if (workerCount > 1) {
      workers = Array.from(
        { length: workerCount },
        () => new Worker(new URL('./jpeg-worker.mjs', import.meta.url)),
      )
    }

    let next = 0
    const processNext = async (worker) => {
      while (next < result.files.length) {
        const index = next++
        const extracted = result.files[index]
        const sourceBytes = await isu.bytesAt(extracted.file, extracted.from, extracted.len)
        const visible = result.visible.get(extracted)
        const outputBytes = worker
          ? await optimizeInWorker(worker, sourceBytes, visible)
          : visible
            ? visibleCrop(sourceBytes, visible)
            : isu.jpegCrop.optimise(sourceBytes) || sourceBytes
        await writeFile(path.join(tempDir, extracted.name), outputBytes)
        totalInputBytes += sourceBytes.length
        totalOutputBytes += outputBytes.length
        console.log(
          `[${index + 1}/${result.files.length}] ${extracted.name}` +
          (visible ? ' (recadrée selon la zone visible du PDF)' : '') +
          ` — ${formatBytes(sourceBytes.length)} → ${formatBytes(outputBytes.length)}`,
        )
      }
    }
    await Promise.all(workers.length
      ? workers.map(processNext)
      : [processNext(null)])
    await rename(tempDir, outputDir)
  } catch (error) {
    await Promise.all(workers.map((worker) => worker.terminate()))
    workers = []
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    throw error
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
    await handle.close()
  }

  const saved = totalInputBytes - totalOutputBytes
  console.log(`\n${result.files.length} page(s) enregistrée(s) dans : ${outputDir}`)
  console.log(
    `JPEG extraits : ${formatBytes(totalInputBytes)} · sortie : ${formatBytes(totalOutputBytes)}` +
    (saved > 0 ? ` · économisés : ${formatBytes(saved)}` : ''),
  )
  if (workers.length > 1) console.log(`Optimisation JPEG avec ${workers.length} workers.`)
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${(bytes / 1024).toFixed(1)} Ko`
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args) await convert(args.input, args.outputDir, args.workers)
} catch (error) {
  console.error(`Erreur : ${error.message}`)
  process.exitCode = 1
}

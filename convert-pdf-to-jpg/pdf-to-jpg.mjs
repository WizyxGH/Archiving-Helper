#!/usr/bin/env node
import { inflateRawSync, inflateSync } from 'node:zlib'
import { open, mkdir, mkdtemp, rename, rm, stat, writeFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerArchivedComicSafely } from '../src/pipelines/4_inducks_collection/collection.mjs'
import vm from 'node:vm'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { spawnSync } from 'node:child_process'

import { createIsu, loadCore, formatOutputName, DEFAULT_OUTPUT_NAME_TEMPLATE } from './package/src/index.mjs'

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
})

loadCore(
  isu,
  (filename) => readFileSync(path.join(packageSrcDir, filename), 'utf8'),
  (code, filename) => vm.runInThisContext(code, { filename }),
)

// ─── Archive helpers ─────────────────────────────────────────────────────────

function findRar() {
  const inPath = spawnSync('where', ['rar'], { encoding: 'utf8', shell: true })
  if (inPath.status === 0 && inPath.stdout.trim()) return 'rar'

  const candidates = [
    'C:\\Program Files\\WinRAR\\Rar.exe',
    'C:\\Program Files (x86)\\WinRAR\\Rar.exe',
  ]
  for (const c of candidates) {
    try { readFileSync(c); return c } catch { /* not found */ }
  }
  return null
}

async function createCbz(jpgDir, archivePath) {
  const tempZip = archivePath + '.tmp.zip'
  try { await rm(tempZip, { force: true }) } catch { /* ignore */ }

  const ps = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath '${jpgDir}' | Select-Object -ExpandProperty FullName) -DestinationPath '${tempZip}'`,
  ], { encoding: 'utf8' })

  if (ps.status !== 0) {
    throw new Error(`Compress-Archive failed: ${(ps.stderr || ps.stdout || '').trim()}`)
  }
  await rename(tempZip, archivePath)
}

async function createCbr(jpgDir, archivePath, rarExe) {
  const result = spawnSync(
    rarExe,
    ['a', '-m0', '-ep', '-idq', archivePath, path.join(jpgDir, '*.jpg')],
    { encoding: 'utf8', shell: true },
  )
  if (result.status !== 0) {
    throw new Error(`WinRAR failed (exit code ${result.status}): ${(result.stderr || result.stdout || '').trim()}`)
  }
}

// ─── Visual progress helper ──────────────────────────────────────────────────

function renderProgressBar(current, total, width = 16) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
  const filled = Math.round(ratio * width)
  const empty = width - filled
  const percent = Math.round(ratio * 100)
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${String(percent).padStart(3, ' ')}%`
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function usage() {
  console.error(
    'Usage: node pdf-to-jpg.mjs <file.pdf | folder ...> [options]\n' +
    '\n' +
    'Options:\n' +
    '  --output-dir <dir>       Output folder for JPG files (created automatically)\n' +
    '  --output-name <template> Filename template (without extension)\n' +
    `                           Default: "${DEFAULT_OUTPUT_NAME_TEMPLATE}"\n` +
    '                           Variables: {name}, {page}, {page:03d}, {total},\n' +
    '                                      {date}, {year}, {month}, {day}\n' +
    '  --archive <cbr|cbz>      Create a CBR (RAR) or CBZ (ZIP) archive after extraction\n' +
    '                           CBR requires WinRAR; CBZ uses PowerShell\n' +
    '  --keep-jpgs              Keep JPG folder after creating archive\n' +
    '                           (by default folder is deleted if --archive is used)\n' +
    '  --workers <count>        Parallel worker count (1–32, default: auto)\n' +
    '\n' +
    'Losslessly extracts and optimizes JPEG pages from PDF files without re-rendering.',
  )
}

function parseArgs(args) {
  const inputs = []
  let outputDir = null
  let outputName = DEFAULT_OUTPUT_NAME_TEMPLATE
  let archive = null
  let keepJpgs = false
  let workers = Math.min(4, Math.max(1, availableParallelism() - 1))

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      usage()
      return null
    } else if (args[i] === '--output-dir') {
      if (outputDir || !args[i + 1]) throw new Error('--output-dir requires one directory')
      outputDir = args[++i]
    } else if (args[i] === '--output-name') {
      if (!args[i + 1]) throw new Error('--output-name requires a template string')
      outputName = args[++i]
    } else if (args[i] === '--archive') {
      const fmt = args[++i]
      if (fmt !== 'cbr' && fmt !== 'cbz') throw new Error('--archive must be cbr or cbz')
      archive = fmt
    } else if (args[i] === '--keep-jpgs') {
      keepJpgs = true
    } else if (args[i] === '--workers') {
      const count = Number(args[++i])
      if (!Number.isInteger(count) || count < 1 || count > 32) {
        throw new Error('--workers must be an integer between 1 and 32')
      }
      workers = count
    } else if (args[i].startsWith('-')) {
      throw new Error(`Unknown option: ${args[i]}`)
    } else {
      inputs.push(args[i])
    }
  }
  if (!inputs.length) {
    usage()
    process.exitCode = 2
    return null
  }
  return {
    inputs,
    outputDir: outputDir && path.resolve(outputDir),
    outputName,
    archive,
    keepJpgs,
    workers,
  }
}

// ─── JPEG worker helpers ──────────────────────────────────────────────────────

function visibleCrop(bytes, visible) {
  const grid = isu.jpegCrop.grid(bytes)
  const snap = (value, step, max) =>
    Math.max(0, Math.min(Math.round(value / step) * step, Math.floor((max - 1) / step) * step))
  const x = snap(visible.x, grid.w, visible.imageW)
  const y = snap(visible.y, grid.h, visible.imageH)
  const w = Math.min(visible.imageW, Math.round(visible.x + visible.w)) - x
  const h = Math.min(visible.imageH, Math.round(visible.y + visible.h)) - y
  if (w <= 0 || h <= 0) throw new Error('Invalid visible PDF region.')
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
    const onError = (error) => { cleanup(); reject(error) }
    const onExit = (code) => { cleanup(); reject(new Error(`JPEG worker stopped (code ${code}).`)) }
    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    worker.postMessage({ bytes: transferable, visible }, [transferable])
  })
}

// ─── Main convert function ────────────────────────────────────────────────────

async function convertSingle(input, requestedOutputDir, outputNameTemplate, archive, keepJpgs, workerLimit, rarExe) {
  const pdfName = path.parse(input).name
  const pdfParent = path.dirname(input)

  const outputDir = requestedOutputDir || path.join(pdfParent, `${pdfName}_jpg`)

  try {
    await stat(outputDir)
    throw new Error(`Output directory already exists: ${outputDir}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const archiveParent = requestedOutputDir ? path.dirname(requestedOutputDir) : pdfParent
  const archivePath = archive ? path.join(archiveParent, `${pdfName}.${archive}`) : null

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
            if (!result.bytesRead) throw new Error('Incomplete read of PDF file.')
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
  const conversionDate = new Date()

  try {
    result = await isu.pdfImages(file)
    if (result.skipped.length) {
      throw new Error(
        `${result.skipped.length} page(s) are not a single JPEG image ` +
        `(${result.skipped.slice(0, 8).join(', ')}${result.skipped.length > 8 ? ', \u2026' : ''}). ` +
        `No partial output was retained.`,
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

    const padDigits = String(result.files.length).length
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

        const outputFilename = formatOutputName(outputNameTemplate, {
          name: pdfName,
          page: index + 1,
          total: result.files.length,
          date: conversionDate,
        })
        await writeFile(path.join(tempDir, outputFilename), outputBytes)
        totalInputBytes += sourceBytes.length
        totalOutputBytes += outputBytes.length
        const pageStr = String(index + 1).padStart(padDigits, '0')
        const totalStr = String(result.files.length).padStart(padDigits, '0')
        const progressBar = renderProgressBar(index + 1, result.files.length)
        console.log(
          `  [${pageStr}/${totalStr}] ${progressBar} ${outputFilename}` +
          (visible ? ' (cropped)' : '') +
          ` — ${formatBytes(sourceBytes.length)} → ${formatBytes(outputBytes.length)}`,
        )
      }
    }
    await Promise.all(workers.length ? workers.map(processNext) : [processNext(null)])
    await rename(tempDir, outputDir)
  } catch (error) {
    await Promise.all(workers.map((w) => w.terminate()))
    workers = []
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    throw error
  } finally {
    await Promise.all(workers.map((w) => w.terminate()))
    await handle.close()
  }

  const saved = totalInputBytes - totalOutputBytes
  console.log(`\n  [SUCCESS] ${result.files.length} page(s) extracted into: ${outputDir}`)
  console.log(
    `  Extracted JPEG: ${formatBytes(totalInputBytes)} · Output: ${formatBytes(totalOutputBytes)}` +
    (saved > 0 ? ` · Saved: ${formatBytes(saved)} (${Math.round((saved / totalInputBytes) * 100)}%)` : ''),
  )

  // ── Archive creation ──────────────────────────────────────────────────────
  if (archive) {
    console.log(`  [ARCHIVING] Creating ${archive.toUpperCase()} archive: ${archivePath}`)
    try {
      await stat(archivePath)
      throw new Error(`Archive already exists: ${archivePath}`)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }

    if (archive === 'cbz') {
      await createCbz(outputDir, archivePath)
    } else {
      await createCbr(outputDir, archivePath, rarExe)
    }

    const archiveStat = await stat(archivePath)
    console.log(`  [ARCHIVED] ${archive.toUpperCase()} size: ${formatBytes(archiveStat.size)}`)
    await registerArchivedComicSafely(archivePath)

    if (!keepJpgs) {
      await rm(outputDir, { recursive: true, force: true })
      console.log(`  [CLEANUP] JPG folder deleted.`)
    }
  }
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

async function collectPdfs(inputPaths) {
  const pdfList = []
  for (const item of inputPaths) {
    const resolved = path.resolve(item)
    try {
      const s = await stat(resolved)
      if (s.isDirectory()) {
        const entries = await readdir(resolved, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            pdfList.push(path.join(resolved, entry.name))
          }
        }
      } else if (s.isFile()) {
        if (resolved.toLowerCase().endsWith('.pdf')) {
          pdfList.push(resolved)
        } else {
          console.warn(`[WARN] Skipping non-PDF file: ${resolved}`)
        }
      }
    } catch (e) {
      console.error(`[ERROR] Cannot access: ${resolved} (${e.message})`)
    }
  }
  return pdfList
}

// ─── Entry point ─────────────────────────────────────────────────────────────

try {
  const args = parseArgs(process.argv.slice(2))
  if (args) {
    let rarExe = null
    if (args.archive === 'cbr') {
      rarExe = findRar()
      if (!rarExe) {
        throw new Error(
          'WinRAR (Rar.exe) not found. Install WinRAR or add it to PATH.\n' +
          '  Checked paths: PATH, C:\\Program Files\\WinRAR\\, C:\\Program Files (x86)\\WinRAR\\',
        )
      }
    }

    const pdfFiles = await collectPdfs(args.inputs)
    if (!pdfFiles.length) {
      console.error('[ERROR] No valid PDF files found to process.')
      process.exitCode = 1
    } else {
      console.log(`[INFO] Found ${pdfFiles.length} PDF file(s) to process.\n`)
      for (let i = 0; i < pdfFiles.length; i++) {
        const pdfPath = pdfFiles[i]
        console.log(`=======================================================`)
        console.log(`[PDF ${i + 1}/${pdfFiles.length}] Processing: ${path.basename(pdfPath)}`)
        console.log(`=======================================================`)
        const targetOutputDir = args.outputDir
          ? (pdfFiles.length === 1 ? args.outputDir : path.join(args.outputDir, `${path.parse(pdfPath).name}_jpg`))
          : null

        await convertSingle(pdfPath, targetOutputDir, args.outputName, args.archive, args.keepJpgs, args.workers, rarExe)
        console.log('')
      }
      console.log(`[COMPLETED] All ${pdfFiles.length} PDF(s) processed successfully.`)
    }
  }
} catch (error) {
  console.error(`\n[FATAL ERROR] ${error.message}`)
  process.exitCode = 1
}

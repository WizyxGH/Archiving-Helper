#!/usr/bin/env node
import { inflateRawSync, inflateSync } from 'node:zlib'
import { open, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

/**
 * Returns the path to Rar.exe or 'rar' if available in PATH.
 * Returns null if WinRAR is not found.
 */
function findRar() {
  // Check PATH first
  const inPath = spawnSync('where', ['rar'], { encoding: 'utf8', shell: true })
  if (inPath.status === 0 && inPath.stdout.trim()) return 'rar'

  // Common WinRAR install locations
  const candidates = [
    'C:\\Program Files\\WinRAR\\Rar.exe',
    'C:\\Program Files (x86)\\WinRAR\\Rar.exe',
  ]
  for (const c of candidates) {
    try { readFileSync(c); return c } catch { /* not found */ }
  }
  return null
}

/**
 * Creates a CBZ archive (ZIP) from a folder of JPGs.
 * Uses PowerShell's Compress-Archive — no extra tools needed on Windows.
 *
 * @param {string} jpgDir    - Source folder containing JPGs
 * @param {string} archivePath - Target .cbz path
 */
async function createCbz(jpgDir, archivePath) {
  // Compress-Archive requires the destination to not already exist.
  // We write to a temp .zip then rename to .cbz.
  const tempZip = archivePath + '.tmp.zip'
  try { await rm(tempZip, { force: true }) } catch { /* ignore */ }

  // -Path "dir\*" includes the files without nesting the folder itself in the archive.
  const ps = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath '${jpgDir}' | Select-Object -ExpandProperty FullName) -DestinationPath '${tempZip}'`,
  ], { encoding: 'utf8' })

  if (ps.status !== 0) {
    throw new Error(`Compress-Archive a échoué : ${(ps.stderr || ps.stdout || '').trim()}`)
  }
  await rename(tempZip, archivePath)
}

/**
 * Creates a CBR archive (RAR) from a folder of JPGs.
 * Requires WinRAR or rar CLI.
 *
 * @param {string} jpgDir    - Source folder containing JPGs
 * @param {string} archivePath - Target .cbr path
 * @param {string} rarExe    - Path to Rar.exe or 'rar'
 */
async function createCbr(jpgDir, archivePath, rarExe) {
  // -m0 : store only (no compression — JPEG data doesn't compress further)
  // -ep : exclude base dir path (store only filenames, no folder prefix)
  // -r  : recurse (in case of nested structure, though we don't create any)
  const result = spawnSync(
    rarExe,
    ['a', '-m0', '-ep', '-idq', archivePath, path.join(jpgDir, '*.jpg')],
    { encoding: 'utf8', shell: true },
  )
  if (result.status !== 0) {
    throw new Error(`WinRAR a échoué (code ${result.status}) : ${(result.stderr || result.stdout || '').trim()}`)
  }
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function usage() {
  console.error(
    'Usage: node pdf-to-jpg.mjs <file.pdf> [options]\n' +
    '\n' +
    'Options:\n' +
    '  --output-dir <dir>       Dossier de sortie pour les JPGs (créé automatiquement)\n' +
    '  --output-name <template> Template du nom de fichier (sans extension)\n' +
    `                           Défaut : "${DEFAULT_OUTPUT_NAME_TEMPLATE}"\n` +
    '                           Variables : {name}, {page}, {page:03d}, {total},\n' +
    '                                       {date}, {year}, {month}, {day}\n' +
    '  --archive <cbr|cbz>      Crée une archive CBR (RAR) ou CBZ (ZIP) après extraction\n' +
    '                           CBR requiert WinRAR ; CBZ utilise PowerShell\n' +
    '  --keep-jpgs              Conserve le dossier de JPGs après création de l\'archive\n' +
    '                           (par défaut le dossier est supprimé si --archive est utilisé)\n' +
    '  --workers <count>        Nombre de workers parallèles (1–32, défaut : auto)\n' +
    '\n' +
    'Extrait et optimise sans perte les pages JPEG d\'un PDF sans le rendre.',
  )
}

function parseArgs(args) {
  let input = null
  let outputDir = null
  let outputName = DEFAULT_OUTPUT_NAME_TEMPLATE
  let archive = null      // null | 'cbr' | 'cbz'
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
  return {
    input: path.resolve(input),
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
    const onError = (error) => { cleanup(); reject(error) }
    const onExit = (code) => { cleanup(); reject(new Error(`Le worker JPEG s'est arrêté (code ${code}).`)) }
    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    worker.postMessage({ bytes: transferable, visible }, [transferable])
  })
}

// ─── Main convert function ────────────────────────────────────────────────────

async function convert(input, requestedOutputDir, outputNameTemplate, archive, keepJpgs, workerLimit) {
  const pdfName = path.parse(input).name
  const pdfParent = path.dirname(input)

  // JPG output dir — always next to the PDF or in requestedOutputDir
  const outputDir = requestedOutputDir ||
    path.join(pdfParent, `${pdfName}_jpg`)

  try {
    await stat(outputDir)
    throw new Error(`Le dossier de sortie existe déjà : ${outputDir}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  // Archive path — same directory as the PDF (or requestedOutputDir's parent)
  const archiveParent = requestedOutputDir ? path.dirname(requestedOutputDir) : pdfParent
  const archivePath = archive ? path.join(archiveParent, `${pdfName}.${archive}`) : null

  // Pre-flight: check WinRAR availability for CBR before starting the conversion
  let rarExe = null
  if (archive === 'cbr') {
    rarExe = findRar()
    if (!rarExe) {
      throw new Error(
        'WinRAR (Rar.exe) introuvable. Installez WinRAR ou ajoutez-le au PATH.\n' +
        '  Chemins vérifiés : PATH, C:\\Program Files\\WinRAR\\, C:\\Program Files (x86)\\WinRAR\\',
      )
    }
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
  const conversionDate = new Date()

  try {
    result = await isu.pdfImages(file)
    if (result.skipped.length) {
      throw new Error(
        `${result.skipped.length} page(s) ne sont pas une image JPEG unique ` +
        `(${result.skipped.slice(0, 8).join(', ')}${result.skipped.length > 8 ? ', \u2026' : ''}). ` +
        `Aucune sortie partielle n\u2019a \u00e9t\u00e9 conserv\u00e9e.`,
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

        const outputFilename = formatOutputName(outputNameTemplate, {
          name: pdfName,
          page: index + 1,
          total: result.files.length,
          date: conversionDate,
        })
        await writeFile(path.join(tempDir, outputFilename), outputBytes)
        totalInputBytes += sourceBytes.length
        totalOutputBytes += outputBytes.length
        console.log(
          `[${index + 1}/${result.files.length}] ${outputFilename}` +
          (visible ? ' (recadr\u00e9e selon la zone visible du PDF)' : '') +
          ` \u2014 ${formatBytes(sourceBytes.length)} \u2192 ${formatBytes(outputBytes.length)}`,
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
  console.log(`\n${result.files.length} page(s) enregistr\u00e9e(s) dans : ${outputDir}`)
  console.log(
    `JPEG extraits : ${formatBytes(totalInputBytes)} \u00b7 sortie : ${formatBytes(totalOutputBytes)}` +
    (saved > 0 ? ` \u00b7 \u00e9conomis\u00e9s : ${formatBytes(saved)}` : ''),
  )
  if (workers.length > 1) console.log(`Optimisation JPEG avec ${workers.length} workers.`)

  // ── Archive creation ──────────────────────────────────────────────────────
  if (archive) {
    console.log(`\nCr\u00e9ation de l\u2019archive ${archive.toUpperCase()} : ${archivePath}`)
    try {
      await stat(archivePath)
      throw new Error(`L\u2019archive existe d\u00e9j\u00e0 : ${archivePath}`)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }

    if (archive === 'cbz') {
      await createCbz(outputDir, archivePath)
    } else {
      await createCbr(outputDir, archivePath, rarExe)
    }

    const archiveStat = await stat(archivePath)
    console.log(`Archive cr\u00e9\u00e9e : ${formatBytes(archiveStat.size)}`)

    if (!keepJpgs) {
      await rm(outputDir, { recursive: true, force: true })
      console.log(`Dossier JPG supprim\u00e9 (utilisez --keep-jpgs pour le conserver).`)
    }
  }
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${(bytes / 1024).toFixed(1)} Ko`
}

// ─── Entry point ─────────────────────────────────────────────────────────────

try {
  const args = parseArgs(process.argv.slice(2))
  if (args) await convert(args.input, args.outputDir, args.outputName, args.archive, args.keepJpgs, args.workers)
} catch (error) {
  console.error(`Erreur : ${error.message}`)
  process.exitCode = 1
}

#!/usr/bin/env node
import { open, mkdir, stat, readFile, readdir, rm, rename } from 'node:fs/promises'
import { createWriteStream, existsSync, statSync, createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createUnzip } from 'node:zlib'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const binDir = path.join(scriptDir, 'bin')
const localAria2 = path.join(binDir, 'aria2c.exe')

// ─── Formatting & Utility Helpers ───────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes) || bytes < 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function cleanUrl(url) {
  return url.trim().replace(/^["']|["']$/g, '')
}

// ─── Aria2c Locator & Bootstrapper ──────────────────────────────────────────

async function getAria2Path() {
  if (existsSync(localAria2)) return localAria2

  const inPath = spawnSync('where', ['aria2c.exe'], { encoding: 'utf8', shell: true })
  if (inPath.status === 0 && inPath.stdout.trim()) {
    return inPath.stdout.trim().split(/\r?\n/)[0]
  }

  // Auto-download portable aria2c into bin/ if missing
  try {
    console.log('Downloading high-speed downloader (aria2c)...')
    await mkdir(binDir, { recursive: true })
    const zipUrl = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
    const tempZip = path.join(binDir, 'aria2.zip')

    const res = await fetch(zipUrl)
    if (res.ok) {
      const fileStream = createWriteStream(tempZip)
      await pipeline(res.body, fileStream)

      // Unzip using PowerShell
      spawnSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${tempZip}' -DestinationPath '${binDir}' -Force`
      ])
      await rm(tempZip, { force: true })

      // Locate extracted aria2c.exe
      const files = await readdir(binDir, { recursive: true })
      for (const f of files) {
        if (path.basename(f).toLowerCase() === 'aria2c.exe') {
          const found = path.join(binDir, f)
          if (found !== localAria2) {
            await rename(found, localAria2)
          }
          console.log('aria2c installed successfully.\n')
          return localAria2
        }
      }
    }
  } catch (err) {
    console.warn(`Could not auto-install aria2c (${err.message}). Using native Node downloader.`)
  }

  return null
}

// ─── DLC Decryptor ───────────────────────────────────────────────────────────

async function decryptDlc(dlcContent) {
  console.log('Decrypting DLC container...')
  
  // Method 1: dcrypt.it API
  try {
    const formData = new URLSearchParams()
    formData.append('content', dlcContent.trim())

    const res = await fetch('http://dcrypt.it/decrypt/paste', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(15000),
    })

    if (res.ok) {
      const data = await res.json()
      if (data?.success?.links && Array.isArray(data.success.links) && data.success.links.length > 0) {
        return data.success.links
      }
    }
  } catch {
    // fallback
  }

  // Method 2: Debrid-link fallback
  try {
    const res = await fetch('https://api.debrid-link.com/v2/downloader/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: dlcContent.trim() }),
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.value && Array.isArray(data.value) && data.value.length > 0) {
        return data.value
      }
    }
  } catch {
    // fallback
  }

  throw new Error('Failed to decrypt DLC container. Check internet connection.')
}

// ─── 1fichier Link Resolver ─────────────────────────────────────────────────

async function resolve1fichier(url, apiKey = null) {
  const token = apiKey || process.env.ONEFICHIER_API_KEY
  if (token) {
    try {
      const res = await fetch('https://api.1fichier.com/v1/download/get_token.cgi', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, single: 1 }),
      })
      const data = await res.json()
      if (data.status === 'OK' && data.url) {
        return { downloadUrl: data.url, filename: data.filename || null }
      }
    } catch (e) {
      console.warn(`1fichier API warning: ${e.message}, falling back to web resolver...`)
    }
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  const pageRes = await fetch(url, { headers: { 'User-Agent': userAgent } })
  if (!pageRes.ok) throw new Error(`1fichier page returned HTTP ${pageRes.status}`)

  const html = await pageRes.text()

  if (html.includes('must wait') || html.includes('devez attendre')) {
    const waitMatch = html.match(/(\d+)\s*(?:minutes|minute|min)/i)
    const waitMinutes = waitMatch ? waitMatch[1] : 'several'
    throw new Error(`1fichier download limit reached. Wait ${waitMinutes} mins or set ONEFICHIER_API_KEY.`)
  }

  const formActionMatch = html.match(/<form[^>]+action=["']([^"']+)["'][^>]*>/i)
  const adzoneMatch = html.match(/<input[^>]+name=["']adzone["'][^>]+value=["']([^"']*)["']/i)
  const dlNoSslMatch = html.match(/<input[^>]+name=["']dl_no_ssl["'][^>]+value=["']([^"']*)["']/i)

  const actionUrl = formActionMatch ? formActionMatch[1] : url
  const postParams = new URLSearchParams()
  if (adzoneMatch) postParams.append('adzone', adzoneMatch[1])
  if (dlNoSslMatch) postParams.append('dl_no_ssl', dlNoSslMatch[1])
  postParams.append('submit', 'Download')

  const postRes = await fetch(actionUrl, {
    method: 'POST',
    headers: {
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': url,
    },
    body: postParams.toString(),
  })

  const postHtml = await postRes.text()
  const directLinkMatch = postHtml.match(/<a[^>]+href=["'](https?:\/\/[^"']+\.1fichier\.com\/[^"']+)["'][^>]*>\s*(?:Click here to download|Télécharger|Download)/i) ||
                          postHtml.match(/href=["'](https?:\/\/[a-z0-9-]+\.(?:1fichier\.com|alterupload\.com|desfichiers\.com|dfichiers\.com|mesfichiers\.org|piecejointe\.net|pjointe\.com|tenvoi\.com)\/[^"']+)["']/i)

  if (directLinkMatch) {
    return { downloadUrl: directLinkMatch[1], filename: null }
  }

  throw new Error('Unable to extract 1fichier direct download link.')
}

export async function resolveMediafire(url) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const pageRes = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!pageRes.ok) throw new Error(`Mediafire returned HTTP ${pageRes.status}`);

  const html = await pageRes.text();
  const directMatch = html.match(/aria-label=["']Download file["'][^>]+href=["'](https?:\/\/[^"']+)["']/i) ||
                      html.match(/id=["']downloadButton["'][^>]+href=["'](https?:\/\/[^"']+)["']/i) ||
                      html.match(/href=["'](https?:\/\/download\d+\.mediafire\.com\/[^"']+)["']/i);

  if (directMatch) {
    return { downloadUrl: directMatch[1], filename: null };
  }
  throw new Error('Unable to extract Mediafire direct download link.');
}

// ─── High-Speed Aria2c Downloader ───────────────────────────────────────────

function downloadWithAria2(aria2Path, urls, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    const inputListFile = path.join(outputDir, `.aria2_input_${Date.now()}.txt`)
    const content = urls.join('\n')
    const maxConnections = options.connections || 16

    createWriteStream(inputListFile).end(content, async () => {
      const args = [
        `--input-file=${inputListFile}`,
        `--dir=${outputDir}`,
        `--max-connection-per-server=${maxConnections}`,
        `--split=${maxConnections}`,
        `--min-split-size=1M`,
        `--max-concurrent-downloads=${options.concurrent || 4}`,
        `--continue=true`,
        `--auto-file-renaming=false`,
        `--allow-overwrite=false`,
        `--summary-interval=1`,
        `--console-log-level=notice`,
      ]

      console.log(`Starting multi-connection download with aria2c (${maxConnections} conns/file)...`)
      const child = spawn(aria2Path, args, { stdio: 'inherit' })

      child.on('close', async (code) => {
        await rm(inputListFile, { force: true })
        if (code === 0) resolve()
        else reject(new Error(`aria2c exited with code ${code}`))
      })
      child.on('error', (err) => reject(err))
    })
  })
}

// ─── Native Node.js Downloader (Fallback) ───────────────────────────────────

async function downloadWithNode(rawUrl, outputDir, options = {}) {
  let targetUrl = rawUrl
  let filename = null

  if (/mediafire\.com/i.test(rawUrl)) {
    process.stdout.write(`Resolving Mediafire link... `)
    const resolved = await resolveMediafire(rawUrl)
    targetUrl = resolved.downloadUrl
    filename = resolved.filename
    console.log('OK')
  } else if (/1fichier\.com|alterupload\.com|desfichiers\.com|dfichiers\.com/i.test(rawUrl)) {
    process.stdout.write(`Resolving 1fichier link... `)
    const resolved = await resolve1fichier(rawUrl, options.apiKey)
    targetUrl = resolved.downloadUrl
    filename = resolved.filename
    console.log('OK')
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  const headRes = await fetch(targetUrl, {
    method: 'GET',
    headers: { 'User-Agent': userAgent },
  })

  if (!headRes.ok) {
    throw new Error(`Download failed with HTTP ${headRes.status} (${headRes.statusText})`)
  }

  if (!filename) {
    const disposition = headRes.headers.get('content-disposition')
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i)
      if (match) filename = decodeURIComponent(match[1])
    }
  }

  if (!filename) {
    try {
      const parsed = new URL(targetUrl)
      filename = path.basename(parsed.pathname)
    } catch {
      filename = `download_${Date.now()}`
    }
  }

  filename = filename.replace(/[<>:"/\\|?*]/g, '_').trim()
  if (!filename) filename = `file_${Date.now()}`

  const targetPath = path.join(outputDir, filename)
  const totalBytes = Number(headRes.headers.get('content-length')) || 0

  if (existsSync(targetPath)) {
    const existingStat = statSync(targetPath)
    if (totalBytes > 0 && existingStat.size === totalBytes) {
      console.log(`[SKIP] Already downloaded: ${filename} (${formatBytes(totalBytes)})`)
      return { filename, size: totalBytes, skipped: true }
    }
  }

  console.log(`\nDownloading: ${filename}`)
  if (totalBytes > 0) console.log(`Size: ${formatBytes(totalBytes)}`)

  const fileStream = createWriteStream(targetPath)
  let downloadedBytes = 0
  const startTime = Date.now()
  let lastUpdate = Date.now()

  const reader = headRes.body.getReader()

  const trackingStream = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read()
        if (done) {
          this.push(null)
          return
        }
        downloadedBytes += value.length
        this.push(value)

        const now = Date.now()
        if (now - lastUpdate > 300 || downloadedBytes === totalBytes) {
          lastUpdate = now
          const elapsedSec = (now - startTime) / 1000
          const speed = elapsedSec > 0 ? downloadedBytes / elapsedSec : 0
          const percent = totalBytes > 0 ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : '?'
          const etaSec = (totalBytes > 0 && speed > 0) ? (totalBytes - downloadedBytes) / speed : -1

          const prog = totalBytes > 0 ? `${percent}%` : `${formatBytes(downloadedBytes)}`
          process.stdout.write(
            `\r  -> [${prog}] ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} | ` +
            `${formatBytes(speed)}/s | ETA: ${formatDuration(etaSec)}   `
          )
        }
      } catch (err) {
        this.destroy(err)
      }
    }
  })

  await pipeline(trackingStream, fileStream)
  console.log(`\n  Done: ${filename}`)
  return { filename, size: downloadedBytes, skipped: false }
}

// ─── Post-Processing Pipeline (Extract & Convert) ────────────────────────────

function findWinRar() {
  const inPath = spawnSync('where', ['WinRAR.exe', 'Rar.exe'], { encoding: 'utf8', shell: true })
  if (inPath.status === 0 && inPath.stdout.trim()) return inPath.stdout.trim().split(/\r?\n/)[0]
  const candidates = [
    'C:\\Program Files\\WinRAR\\WinRAR.exe',
    'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe',
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

async function flattenDirectory(targetDir) {
  const entries = await readdir(targetDir, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile())
  const dirs = entries.filter((e) => e.isDirectory())

  if (files.length === 0 && dirs.length === 1) {
    const singleSub = path.join(targetDir, dirs[0].name)
    console.log(`  Flattening nested directory: ${dirs[0].name}`)
    const subEntries = await readdir(singleSub)
    for (const item of subEntries) {
      await rename(path.join(singleSub, item), path.join(targetDir, item))
    }
    await rm(singleSub, { recursive: true, force: true })
    await flattenDirectory(targetDir)
  }
}

async function runPostProcessing(outputDir, options = {}) {
  console.log(`\n========================================`)
  console.log(`  Running Post-Processing Pipeline`)
  console.log(`========================================\n`)

  const files = await readdir(outputDir)
  const archives = files.filter((f) => /\.(cbr|cbz|zip|rar|7z)$/i.test(f))
  const pdfs = files.filter((f) => /\.pdf$/i.test(f))
  const winRar = findWinRar()

  // 1. Auto-extract archives
  if (options.autoExtract && archives.length > 0) {
    console.log(`Found ${archives.length} archive(s) to extract...`)
    for (const archive of archives) {
      const archivePath = path.join(outputDir, archive)
      const folderName = path.parse(archive).name
      const targetFolder = path.join(outputDir, folderName)

      console.log(`Extracting: ${archive} -> ${folderName}/`)
      await mkdir(targetFolder, { recursive: true })

      if (winRar) {
        spawnSync(winRar, ['x', '-idq', '-y', archivePath, targetFolder + '\\'], { shell: true })
      } else {
        // Fallback PowerShell for ZIP/CBZ
        spawnSync('powershell', [
          '-NoProfile', '-Command',
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${targetFolder}' -Force`
        ])
      }

      await flattenDirectory(targetFolder)

      if (options.cleanArchives) {
        await rm(archivePath, { force: true })
        console.log(`  Deleted original archive: ${archive}`)
      }
    }
  }

  // 2. Auto-convert PDFs
  if (options.autoConvert && pdfs.length > 0) {
    const pdfConverterScript = path.join(scriptDir, '..', 'convert-pdf-to-jpg', 'pdf-to-jpg.mjs')
    if (existsSync(pdfConverterScript)) {
      console.log(`Found ${pdfs.length} PDF(s) to convert to lossless JPG/CBZ...`)
      for (const pdf of pdfs) {
        const pdfPath = path.join(outputDir, pdf)
        console.log(`Converting PDF: ${pdf}`)
        spawnSync('node', [pdfConverterScript, pdfPath, '--archive', 'cbz'], { stdio: 'inherit' })
      }
    }
  }

  console.log('\nPost-processing complete!')
}

// ─── Main Batch Controller ───────────────────────────────────────────────────

async function processInputFile(filePath, options = {}) {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) throw new Error(`Input is not a file: ${filePath}`)

  const fileExt = path.extname(filePath).toLowerCase()
  const baseName = path.parse(filePath).name
  const parentDir = path.dirname(filePath)

  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(parentDir, `${baseName}_downloads`)

  await mkdir(outputDir, { recursive: true })

  const rawContent = await readFile(filePath, 'utf8')
  let urls = []

  if (fileExt === '.dlc') {
    urls = await decryptDlc(rawContent)
  } else {
    urls = rawContent
      .split(/\r?\n/)
      .map(cleanUrl)
      .filter((line) => /^https?:\/\//i.test(line))
  }

  if (urls.length === 0) throw new Error('No valid download URLs found in file.')

  console.log(`\n========================================`)
  console.log(`  Batch Downloader`)
  console.log(`  Input:     ${path.basename(filePath)}`)
  console.log(`  Links:     ${urls.length}`)
  console.log(`  Output:    ${outputDir}`)
  console.log(`========================================\n`)

  const webComicUrls = urls.filter(u => /comic-viewer|bookUri=|comicmafia\.to\/reader/i.test(u))
  const directUrls = urls.filter(u => !/comic-viewer|bookUri=|comicmafia\.to\/reader/i.test(u))

  // Download all Web Comic Reader volumes directly into clean CBZ archives
  if (webComicUrls.length > 0) {
    console.log(`[+] ${webComicUrls.length} tome(s) de lecteur Web détecté(s). Téléchargement automatique vers CBZ...`)
    for (let i = 0; i < webComicUrls.length; i++) {
      console.log(`\n--- [Tome Web ${i + 1}/${webComicUrls.length}] ---`)
      try {
        await downloadWebComic(webComicUrls[i], outputDir, null, options)
      } catch (err) {
        console.error(`  [ERROR] Échec téléchargement tome : ${err.message}`)
      }
    }
  }

  // Download all direct files / archives using aria2c (or Node fallback)
  if (directUrls.length > 0) {
    console.log(`\n[+] ${directUrls.length} lien(s) direct(s) à télécharger avec aria2c...`)
    const resolvedUrls = []
    for (let i = 0; i < directUrls.length; i++) {
      const u = directUrls[i]
      if (/1fichier\.com|alterupload\.com|desfichiers\.com|dfichiers\.com/i.test(u)) {
        try {
          process.stdout.write(`Resolving [${i + 1}/${directUrls.length}] 1fichier... `)
          const res = await resolve1fichier(u, options.apiKey)
          resolvedUrls.push(res.downloadUrl)
          console.log('OK')
        } catch (err) {
          console.error(`Failed: ${err.message}`)
        }
      } else {
        resolvedUrls.push(u)
      }
    }

    const aria2Path = options.noAria2 ? null : await getAria2Path()

    if (aria2Path && resolvedUrls.length > 0) {
      await downloadWithAria2(aria2Path, resolvedUrls, outputDir, options)
    } else {
      for (let i = 0; i < directUrls.length; i++) {
        console.log(`[${i + 1}/${directUrls.length}] ${directUrls[i]}`)
        try {
          await downloadWithNode(directUrls[i], outputDir, options)
        } catch (err) {
          console.error(`  [ERROR] ${err.message}`)
        }
      }
    }
  }

  // Run post-processing pipeline if enabled
  if (options.autoExtract || options.autoConvert) {
    await runPostProcessing(outputDir, options)
  }
}

// ─── Watcher Mode ────────────────────────────────────────────────────────────

async function startWatcher(watchDir, options = {}) {
  console.log(`\n[WATCHER] Monitoring folder: ${watchDir}`)
  console.log(`Drop any .txt (with links) or .dlc file into this folder to download automatically.\n`)

  const processed = new Set()

  setInterval(async () => {
    try {
      const files = await readdir(watchDir)
      for (const f of files) {
        if (/\.(txt|dlc)$/i.test(f) && !processed.has(f) && !f.startsWith('.')) {
          processed.add(f)
          const fullPath = path.join(watchDir, f)
          console.log(`\n[WATCHER] New file detected: ${f}`)
          try {
            await processInputFile(fullPath, options)
            console.log(`[WATCHER] Finished processing: ${f}\n`)
          } catch (err) {
            console.error(`[WATCHER ERROR] ${f}: ${err.message}\n`)
          }
        }
      }
    } catch {}
  }, 2500)
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

function usage() {
  console.error(
    'Usage: node download.mjs <links.txt|container.dlc> [options]\n' +
    '       node download.mjs --watch [folder] [options]\n' +
    '\n' +
    'Speed Options:\n' +
    '  --connections <n>     Parallel connections per file with aria2c (default: 16)\n' +
    '  --concurrent <n>      Concurrent files being downloaded (default: 4)\n' +
    '  --no-aria2            Disable aria2c and use Node native streaming\n' +
    '\n' +
    'Pipeline Options:\n' +
    '  --auto-extract        Auto-extract CBR, CBZ, ZIP, RAR and flatten subfolders\n' +
    '  --clean-archives      Delete archives after extraction to save disk space\n' +
    '  --auto-convert        Auto-convert extracted PDFs to lossless CBZ/JPG\n' +
    '\n' +
    'General Options:\n' +
    '  --output-dir <dir>    Destination directory\n' +
    '  --api-key <key>       1fichier API key (bypasses free waiting time)\n' +
    '  --watch [folder]      Watch folder mode (auto-downloads any new .txt/.dlc)\n' +
    '  --help, -h            Show this help message\n'
  )
}

function parseArgs(args) {
  let input = null
  let outputDir = null
  let apiKey = null
  let watchMode = false
  let watchDir = null
  let autoExtract = false
  let cleanArchives = false
  let autoConvert = false
  let noAria2 = false
  let connections = 16
  let concurrent = 4

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      usage()
      return null
    } else if (args[i] === '--output-dir') {
      outputDir = args[++i]
    } else if (args[i] === '--api-key') {
      apiKey = args[++i]
    } else if (args[i] === '--watch') {
      watchMode = true
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        watchDir = args[++i]
      }
    } else if (args[i] === '--auto-extract') {
      autoExtract = true
    } else if (args[i] === '--clean-archives') {
      cleanArchives = true
    } else if (args[i] === '--auto-convert') {
      autoConvert = true
    } else if (args[i] === '--no-aria2') {
      noAria2 = true
    } else if (args[i] === '--connections') {
      connections = Number(args[++i]) || 16
    } else if (args[i] === '--concurrent') {
      concurrent = Number(args[++i]) || 4
    } else if (args[i].startsWith('-')) {
      throw new Error(`Unknown option: ${args[i]}`)
    } else if (!input) {
      input = args[i]
    }
  }

  if (watchMode) {
    return {
      watchMode: true,
      watchDir: path.resolve(watchDir || process.cwd()),
      outputDir,
      apiKey,
      autoExtract,
      cleanArchives,
      autoConvert,
      noAria2,
      connections,
      concurrent,
    }
  }

  if (!input) {
    usage()
    process.exitCode = 2
    return null
  }

  return {
    input: path.resolve(input),
    outputDir,
    apiKey,
    autoExtract,
    cleanArchives,
    autoConvert,
    noAria2,
    connections,
    concurrent,
  }
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args) {
    if (args.watchMode) {
      await startWatcher(args.watchDir, args)
    } else {
      await processInputFile(args.input, args)
    }
  }
} catch (err) {
  console.error(`\nFatal error: ${err.message}`)
  process.exitCode = 1
}

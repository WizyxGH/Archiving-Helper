#!/usr/bin/env node
import { open, mkdir, stat, readFile, readdir, rm, rename } from 'node:fs/promises'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import http from 'node:http'
import crypto from 'node:crypto'
import readline from 'node:readline'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const binDir = path.join(scriptDir, 'bin')
const localAria2 = path.join(binDir, 'aria2c.exe')

// ─── Environment & Configuration Loader ─────────────────────────────────────

async function loadEnvFile() {
  const envPaths = [
    path.join(scriptDir, '.env'),
    path.join(process.cwd(), '.env'),
  ]
  for (const p of envPaths) {
    if (existsSync(p)) {
      try {
        const content = await readFile(p, 'utf8')
        for (const line of content.split(/\r?\n/)) {
          const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
          if (match && !match[1].startsWith('#')) {
            const key = match[1]
            let val = (match[2] || '').trim()
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1)
            }
            if (!process.env[key] && val) {
              process.env[key] = val
            }
          }
        }
      } catch {}
    }
  }
}

await loadEnvFile()

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

function openInBrowser(url) {
  try {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
  } catch {}
}

// ─── Aria2c Locator & Auto-Bootstrapper ──────────────────────────────────────

async function getAria2Path() {
  if (existsSync(localAria2)) return localAria2

  const inPath = spawnSync('where', ['aria2c.exe'], { encoding: 'utf8', shell: true })
  if (inPath.status === 0 && inPath.stdout.trim()) {
    return inPath.stdout.trim().split(/\r?\n/)[0]
  }

  try {
    process.stdout.write('Downloading high-speed aria2c accelerator... ')
    await mkdir(binDir, { recursive: true })
    const zipUrl = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
    const tempZip = path.join(binDir, 'aria2.zip')

    const res = await fetch(zipUrl)
    if (res.ok) {
      const fileStream = createWriteStream(tempZip)
      await pipeline(res.body, fileStream)

      spawnSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${tempZip}' -DestinationPath '${binDir}' -Force`
      ])
      await rm(tempZip, { force: true })

      const files = await readdir(binDir, { recursive: true })
      for (const f of files) {
        if (path.basename(f).toLowerCase() === 'aria2c.exe') {
          const found = path.join(binDir, f)
          if (found !== localAria2) await rename(found, localAria2)
          console.log('OK (installed)')
          return localAria2
        }
      }
    }
  } catch (err) {
    console.log(`(failed: ${err.message}, using native downloader)`)
  }

  return null
}

// ─── Click'n'Load (CNL2) Decryptor ──────────────────────────────────────────

function decryptCnl2(cryptedBase64, jkCode) {
  let keyHex = ''
  try {
    const match = jkCode.match(/return\s*['"]([0-9a-fA-F]+)['"]/i)
    if (match) {
      keyHex = match[1]
    } else {
      const fn = new Function(jkCode + '; return f();')
      keyHex = fn()
    }
  } catch (err) {
    throw new Error(`Failed to extract Click'n'Load key: ${err.message}`)
  }

  const keyBuffer = Buffer.from(keyHex, 'hex')
  const cipherBuffer = Buffer.from(cryptedBase64, 'base64')

  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, keyBuffer)
  decipher.setAutoPadding(false)

  let decrypted = Buffer.concat([decipher.update(cipherBuffer), decipher.final()]).toString('utf8')
  decrypted = decrypted.replace(/\0/g, '')

  return decrypted.split(/\r?\n/).map(cleanUrl).filter((u) => /^https?:\/\//i.test(u))
}

// ─── DLC Decryptor ───────────────────────────────────────────────────────────

async function decryptDlc(dlcContent) {
  process.stdout.write('Decrypting DLC container... ')
  
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
        console.log(`OK (${data.success.links.length} links found)`)
        return data.success.links
      }
    }
  } catch {}

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
        console.log(`OK (${data.value.length} links found)`)
        return data.value
      }
    }
  } catch {}

  throw new Error('Failed to decrypt DLC container. Please check your internet connection.')
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
    } catch {}
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

// ─── Universal Link Resolver & Multi-Debrider ───────────────────────────────

async function resolveDirectDownloadLink(rawUrl, options = {}) {
  const url = cleanUrl(rawUrl)

  // 1. Real-Debrid API (https://real-debrid.com/apitoken)
  const rdToken = options.debriderKey || process.env.REALDEBRID_API_KEY || process.env.DEBRIDER_TOKEN || process.env.RD_TOKEN
  if (rdToken) {
    try {
      const res = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${rdToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ link: url }).toString(),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.download) {
          return { downloadUrl: data.download, filename: data.filename || null, host: 'Real-Debrid' }
        }
      }
    } catch {}
  }

  // 2. AllDebrid API (https://alldebrid.com/apikeys)
  const adToken = options.allDebridKey || process.env.ALLDEBRID_API_KEY
  if (adToken) {
    try {
      const res = await fetch(`https://api.alldebrid.com/v4/link/unlock?agent=archiving-helper&apikey=${adToken}&link=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.status === 'success' && data?.data?.link) {
          return { downloadUrl: data.data.link, filename: data.data.filename || null, host: 'AllDebrid' }
        }
      }
    } catch {}
  }

  // 3. Debrid-Link API
  const dlToken = options.debridLinkKey || process.env.DEBRIDLINK_API_KEY
  if (dlToken) {
    try {
      const res = await fetch('https://api.debrid-link.com/v2/downloader/add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dlToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.value?.downloadUrl) {
          return { downloadUrl: data.value.downloadUrl, filename: data.value.name || null, host: 'Debrid-Link' }
        }
      }
    } catch {}
  }

  // 4. 1fichier Resolver (Free & API)
  if (/1fichier\.com|alterupload\.com|desfichiers\.com|dfichiers\.com|mesfichiers\.org|piecejointe\.net|pjointe\.com|tenvoi\.com/i.test(url)) {
    const res = await resolve1fichier(url, options.apiKey)
    return { downloadUrl: res.downloadUrl, filename: res.filename, host: '1fichier' }
  }

  // 5. Pixeldrain Resolver
  const pixelMatch = url.match(/pixeldrain\.com\/u\/([a-zA-Z0-9]+)/i)
  if (pixelMatch) {
    return { downloadUrl: `https://pixeldrain.com/api/file/${pixelMatch[1]}?download`, filename: null, host: 'Pixeldrain' }
  }

  // 6. Krakenfiles Resolver
  if (/krakenfiles\.com\/view\/([a-zA-Z0-9]+)/i.test(url)) {
    try {
      const pageRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const html = await pageRes.text()
      const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/i)
      const postUrlMatch = html.match(/action="([^"]+)"/i)
      if (tokenMatch && postUrlMatch) {
        const postRes = await fetch(postUrlMatch[1], {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
          body: new URLSearchParams({ token: tokenMatch[1] }).toString(),
        })
        const json = await postRes.json()
        if (json?.url) return { downloadUrl: json.url, filename: null, host: 'Krakenfiles' }
      }
    } catch {}
  }

  // 7. Gofile Resolver
  const gofileMatch = url.match(/gofile\.io\/d\/([a-zA-Z0-9]+)/i)
  if (gofileMatch) {
    try {
      const apiRes = await fetch(`https://api.gofile.io/contents/${gofileMatch[1]}?wt=4fd6sg89d7s6`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const data = await apiRes.json()
      if (data?.data?.children) {
        const firstFile = Object.values(data.data.children)[0]
        if (firstFile?.link) return { downloadUrl: firstFile.link, filename: firstFile.name, host: 'Gofile' }
      }
    } catch {}
  }

  // 8. Rapidgator / DDownload notice if not unrestrictable
  if (/rapidgator\.net|rg\.to|ddownload\.com|turbobit\.net|katfile\.com|nitroflare\.com/i.test(url)) {
    console.warn(`\n[NOTICE] Rapidgator link detected. Add your Real-Debrid / AllDebrid token to download-files/.env for 100MB/s direct download.`)
  }

  return { downloadUrl: url, filename: null, host: 'Direct' }
}

// ─── Multi-Connection aria2c Downloader ─────────────────────────────────────

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
        `--async-dns-server=1.1.1.1,8.8.8.8,1.0.0.1,8.8.4.4`,
        `--async-dns=true`,
      ]

      console.log(`\nLaunching aria2c with ${maxConnections} parallel connections per file...\n`)
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

async function downloadWithNode(resolvedItem, outputDir, options = {}) {
  let targetUrl = resolvedItem.downloadUrl
  let filename = resolvedItem.filename

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
  console.log(`  Post-Processing Pipeline`)
  console.log(`========================================\n`)

  const files = await readdir(outputDir)
  const archives = files.filter((f) => /\.(cbr|cbz|zip|rar|7z)$/i.test(f))
  const pdfs = files.filter((f) => /\.pdf$/i.test(f))
  const winRar = findWinRar()

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
        spawnSync('powershell', [
          '-NoProfile', '-Command',
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${targetFolder}' -Force`
        ])
      }

      await flattenDirectory(targetFolder)

      if (options.cleanArchives) {
        await rm(archivePath, { force: true })
        console.log(`  Deleted archive: ${archive}`)
      }
    }
  }

  if (options.autoConvert && pdfs.length > 0) {
    const pdfConverterScript = path.join(scriptDir, '..', 'convert-pdf-to-jpg', 'pdf-to-jpg.mjs')
    if (existsSync(pdfConverterScript)) {
      console.log(`Found ${pdfs.length} PDF(s) to convert...`)
      for (const pdf of pdfs) {
        const pdfPath = path.join(outputDir, pdf)
        console.log(`Converting PDF: ${pdf}`)
        spawnSync('node', [pdfConverterScript, pdfPath, '--archive', 'cbz'], { stdio: 'inherit' })
      }
    }
  }

  console.log('\nPost-processing complete!')
}

// ─── Batch Downloader Engine ─────────────────────────────────────────────────

async function downloadUrlsList(urls, outputDir, options = {}) {
  await mkdir(outputDir, { recursive: true })

  console.log(`\n========================================`)
  console.log(`  Batch Downloader`)
  console.log(`  Links count: ${urls.length}`)
  console.log(`  Target:      ${outputDir}`)
  console.log(`========================================\n`)

  const resolvedItems = []
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i]
    process.stdout.write(`Resolving [${i + 1}/${urls.length}] ${u.slice(0, 50)}... `)
    try {
      const res = await resolveDirectDownloadLink(u, options)
      resolvedItems.push(res)
      console.log(`OK (${res.host})`)
    } catch (err) {
      console.log(`Failed: ${err.message}`)
      resolvedItems.push({ downloadUrl: u, filename: null, host: 'Direct' })
    }
  }

  const directUrls = resolvedItems.map((r) => r.downloadUrl)
  const aria2Path = options.noAria2 ? null : await getAria2Path()

  if (aria2Path && directUrls.length > 0) {
    await downloadWithAria2(aria2Path, directUrls, outputDir, options)
  } else {
    for (let i = 0; i < resolvedItems.length; i++) {
      try {
        await downloadWithNode(resolvedItems[i], outputDir, options)
      } catch (err) {
        console.error(`  [ERROR] ${err.message}`)
      }
    }
  }

  if (options.autoExtract || options.autoConvert) {
    await runPostProcessing(outputDir, options)
  }
}

// ─── Click'n'Load (CNL2) HTTP Server ─────────────────────────────────────────

function startCnlServer(options = {}) {
  const PORT = 9666
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    const urlPath = req.url.split('?')[0]

    if (req.method === 'GET' && (urlPath === '/flash' || urlPath === '/flash/')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('JDownloader')
      return
    }

    if (req.method === 'GET' && urlPath === '/flash/add') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('JDownloader')
      return
    }

    if (req.method === 'POST' && urlPath.includes('addcrypted2')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body)
          const crypted = params.get('crypted')
          const jk = params.get('jk')
          const packageName = params.get('package') || `CNL_Download_${Date.now()}`

          if (!crypted || !jk) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Missing crypted or jk')
            return
          }

          console.log(`\n[CNL] Received Click'n'Load package: ${packageName}`)
          const decryptedUrls = decryptCnl2(crypted, jk)
          console.log(`[CNL] Successfully decrypted ${decryptedUrls.length} link(s)!`)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('success\r\n')

          const outputDir = options.outputDir
            ? path.resolve(options.outputDir)
            : path.join(process.cwd(), `${packageName}_downloads`)

          await downloadUrlsList(decryptedUrls, outputDir, options)
        } catch (err) {
          console.error(`[CNL ERROR] ${err.message}`)
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Error')
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CNL SERVER] Listening on http://127.0.0.1:${PORT}`)
    console.log(`-> Click "Click'n'Load" on Filecrypt in your browser and it will download automatically!\n`)
  })

  return server
}

// ─── Input File Processor ────────────────────────────────────────────────────

async function processInputFile(filePath, options = {}) {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) throw new Error(`Not a file: ${filePath}`)

  const fileExt = path.extname(filePath).toLowerCase()
  const baseName = path.parse(filePath).name
  const parentDir = path.dirname(filePath)

  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(parentDir, `${baseName}_downloads`)

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
  await downloadUrlsList(urls, outputDir, options)
}

// ─── Filecrypt Container Handler ─────────────────────────────────────────────

async function handleFilecryptContainer(containerUrl, options = {}) {
  console.log(`\n======================================================================`)
  console.log(`  [FILECRYPT CONTAINER DETECTED]`)
  console.log(`  URL: ${containerUrl}`)
  console.log(`======================================================================`)
  console.log(`\n1. Opening container page in your default browser...`)
  openInBrowser(containerUrl)

  console.log(`2. Starting Click'n'Load local receiver on port 9666...`)
  startCnlServer(options)

  console.log(`\nInstructions:`)
  console.log(`  - Solve the captcha / enter password in your browser.`)
  console.log(`  - Click the green "Click'n'Load" button (or download the .dlc container).`)
  console.log(`  - The files will be captured, decrypted, and downloaded at maximum speed!\n`)
}

// ─── Watcher Mode ────────────────────────────────────────────────────────────

async function startWatcher(watchDir, options = {}) {
  console.log(`\n[WATCHER] Monitoring: ${watchDir}`)
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
            console.log(`[WATCHER] Finished: ${f}\n`)
          } catch (err) {
            console.error(`[WATCHER ERROR] ${f}: ${err.message}\n`)
          }
        }
      }
    } catch {}
  }, 2500)
}

// ─── Interactive Console Mode ────────────────────────────────────────────────

async function promptInteractive(options) {
  startCnlServer(options)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log('You can also paste links or a Filecrypt container URL below:')

  rl.question('> ', async (answer) => {
    const input = answer.trim()
    if (!input) return

    if (/filecrypt\.(?:cc|co|to)\/Container\//i.test(input)) {
      await handleFilecryptContainer(input, options)
    } else if (input.startsWith('http')) {
      const outputDir = options.outputDir || path.join(process.cwd(), 'downloads')
      await downloadUrlsList([input], outputDir, options)
    } else if (existsSync(input)) {
      await processInputFile(input, options)
    }
  })
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

function usage() {
  console.error(
    'Usage: node download.mjs [file.txt | file.dlc | url] [options]\n' +
    '       node download.mjs --server\n' +
    '       node download.mjs --watch [folder]\n' +
    '\n' +
    'Performance Options:\n' +
    '  --connections <n>     Parallel connections per file with aria2c (default: 16)\n' +
    '  --concurrent <n>      Concurrent files being downloaded (default: 4)\n' +
    '  --no-aria2            Disable aria2c and use Node native streaming\n' +
    '\n' +
    'Pipeline Options:\n' +
    '  --auto-extract        Auto-extract CBR, CBZ, ZIP, RAR and flatten subfolders\n' +
    '  --clean-archives      Delete archives after extraction\n' +
    '  --auto-convert        Auto-convert extracted PDFs to lossless CBZ/JPG\n' +
    '\n' +
    'Debrider & Host Tokens:\n' +
    '  --debrider <token>    Real-Debrid API token for 100MB/s Rapidgator/DDownload\n' +
    '  --alldebrid <token>   AllDebrid API key\n' +
    '  --api-key <key>       1fichier API key\n' +
    '  (or configure in download-files/.env)\n' +
    '\n' +
    'Modes:\n' +
    '  --server, --cnl       Run Click\'n\'Load background server (captures Filecrypt 1-click)\n' +
    '  --watch [folder]      Watch folder mode (auto-downloads any new .txt/.dlc)\n' +
    '  --output-dir <dir>    Destination directory\n' +
    '  --help, -h            Show this help message\n'
  )
}

function parseArgs(args) {
  let input = null
  let outputDir = null
  let apiKey = null
  let debriderKey = null
  let allDebridKey = null
  let watchMode = false
  let watchDir = null
  let serverMode = false
  let autoExtract = true
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
    } else if (args[i] === '--debrider') {
      debriderKey = args[++i]
    } else if (args[i] === '--alldebrid') {
      allDebridKey = args[++i]
    } else if (args[i] === '--server' || args[i] === '--cnl') {
      serverMode = true
    } else if (args[i] === '--watch') {
      watchMode = true
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        watchDir = args[++i]
      }
    } else if (args[i] === '--no-extract') {
      autoExtract = false
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

  return {
    input: input ? (input.startsWith('http') ? input : path.resolve(input)) : null,
    outputDir,
    apiKey,
    debriderKey,
    allDebridKey,
    watchMode,
    watchDir: path.resolve(watchDir || process.cwd()),
    serverMode,
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
    if (args.serverMode) {
      startCnlServer(args)
    } else if (args.watchMode) {
      await startWatcher(args.watchDir, args)
    } else if (args.input) {
      if (/filecrypt\.(?:cc|co|to)\/Container\//i.test(args.input)) {
        await handleFilecryptContainer(args.input, args)
      } else if (args.input.startsWith('http')) {
        const out = args.outputDir || path.join(process.cwd(), 'downloads')
        await downloadUrlsList([args.input], out, args)
      } else {
        await processInputFile(args.input, args)
      }
    } else {
      await promptInteractive(args)
    }
  }
} catch (err) {
  console.error(`\nFatal error: ${err.message}`)
  process.exitCode = 1
}

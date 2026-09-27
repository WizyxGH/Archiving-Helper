/**
 * @module pdf-to-jpg-core
 *
 * Browser-safe core for lossless PDF-to-JPEG extraction.
 * Works in any JS environment that provides the `isu` adapter object.
 *
 * Usage (Node.js):
 *   import { createIsu, loadCore, formatOutputName } from '@starl/pdf-to-jpg-core'
 *
 * Usage (browser extension):
 *   Load pdf-core.js and jpeg-core.js as plain content scripts;
 *   they install themselves on window.ISU. No import needed.
 */

// ─── ISU adapter factory ────────────────────────────────────────────────────

/**
 * Creates a minimal ISU adapter object for the core libraries.
 *
 * @param {{
 *   inflate(bytes: Uint8Array): Promise<Uint8Array>,
 *   bytesAt(file: object, from: number, len: number): Promise<Uint8Array>,
 *   fileFrom?(file: object, from: number, len: number, name: string, type: string): Promise<object>,
 *   exifOrientation?(bytes: Uint8Array, view: DataView, from: number, to: number): number,
 * }} impl - Platform-specific implementations.
 * @returns {object} ISU adapter ready to be placed on `window.ISU` or passed to `loadCore`.
 */
export function createIsu(impl) {
  return {
    stage() {},
    async bytesAt(file, from, len) {
      return impl.bytesAt(file, from, len)
    },
    async fileFrom(file, from, len, name, type) {
      if (impl.fileFrom) return impl.fileFrom(file, from, len, name, type)
      return { file, from, len, name, type, size: len }
    },
    async inflate(bytes) {
      return impl.inflate(bytes)
    },
    exifOrientation(bytes, view, from, to) {
      if (impl.exifOrientation) return impl.exifOrientation(bytes, view, from, to)
      return 1
    },
  }
}

// ─── Core loader ────────────────────────────────────────────────────────────

/**
 * Loads pdf-core.js and jpeg-core.js into the given global context and returns
 * the populated ISU object. In Node.js, pass a `vm` context; in the browser
 * extension the files are loaded as content scripts, so this function is not needed.
 *
 * @param {object} isu - An ISU adapter created by `createIsu()`.
 * @param {(filename: string) => string} readFile - Sync function returning the JS source.
 * @param {(code: string, filename: string) => void} runInContext - Evaluates code in context.
 * @returns {object} The same `isu` object, now enriched with `.pdfImages` and `.jpegCrop`.
 */
export function loadCore(isu, readFile, runInContext) {
  const saved = globalThis.window
  globalThis.window = { ISU: isu }
  try {
    for (const file of ['jpeg-core.js', 'pdf-core.js']) {
      runInContext(readFile(file), file)
    }
  } finally {
    globalThis.window = saved
  }
  return isu
}

// ─── Output name template ───────────────────────────────────────────────────

/**
 * Resolves an output filename template.
 *
 * Supported placeholders:
 *   {name}          — PDF base name without extension
 *   {page}          — 1-based page number (no padding)
 *   {page:03d}      — page zero-padded to 3 digits  (any width: 02d, 04d, …)
 *   {total}         — total number of pages
 *   {date}          — ISO date YYYY-MM-DD (local time)
 *   {year}          — 4-digit year
 *   {month}         — 2-digit month (01–12)
 *   {day}           — 2-digit day (01–31)
 *
 * The `.jpg` extension is always appended automatically; do NOT include it in
 * the template.
 *
 * @param {string} template - Template string, e.g. `"{name}_{page:04d}"`.
 * @param {{ name: string, page: number, total: number, date?: Date }} vars
 * @returns {string} Resolved filename including `.jpg` extension.
 *
 * @example
 * formatOutputName('{name}_{page:03d}', { name: 'JM2045', page: 7, total: 52 })
 * // → 'JM2045_007.jpg'
 */
export function formatOutputName(template, vars) {
  const { name, page, total } = vars
  const date = vars.date ?? new Date()
  const pad = (n, w) => String(n).padStart(w, '0')
  const yyyy = date.getFullYear()
  const mm = pad(date.getMonth() + 1, 2)
  const dd = pad(date.getDate(), 2)

  const resolved = template.replace(
    /\{(\w+)(?::(\d+)d)?\}/g,
    (match, key, width) => {
      const w = width ? parseInt(width, 10) : 0
      switch (key) {
        case 'name':  return name
        case 'page':  return w ? pad(page, w) : String(page)
        case 'total': return w ? pad(total, w) : String(total)
        case 'date':  return `${yyyy}-${mm}-${dd}`
        case 'year':  return String(yyyy)
        case 'month': return mm
        case 'day':   return dd
        default:      return match // leave unknown placeholders as-is
      }
    },
  )
  return `${resolved}.jpg`
}

/**
 * Default output name template used by the CLI when none is specified.
 * Produces names like `my-magazine_0001.jpg`.
 */
export const DEFAULT_OUTPUT_NAME_TEMPLATE = '{name}_{page:04d}'

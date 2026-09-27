// Reading the images of a PDF without decoding or re-encoding anything.
//
// A magazine PDF stores each page as a single JPEG, already compressed, sitting contiguously in
// the file (`/Filter /DCTDecode`). Those bytes are the scan: taking them is lossless and costs
// nothing — no rendering, no DPI to choose, no resampling. Rendering the page instead (what a
// "PDF → JPEG" converter does) forces a resolution and always either blurs or invents pixels.
//
// Getting the bytes is the easy half; getting them in the RIGHT ORDER is the reason this file
// parses the document properly (cross-reference table or stream, object streams, page tree)
// instead of scanning for image objects. Sending page 12 as page 7 would be worse than useless.
//
// Anything not plainly readable is refused with a reason, never guessed: encrypted files, pages
// carrying several images or none, images stored in another format (JPEG 2000, Flate…).
;(() => {
  const ISU = window.ISU
  const WS = new Set([0, 9, 10, 12, 13, 32])
  const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])
  const latin = new TextDecoder('latin1')

  /**
   * PNG predictors, used by cross-reference and object streams: each row is stored as the
   * difference with the previous one, so it has to be undone before the rows mean anything.
   */
  function unpredict(data, predictor, colors, bpc, columns) {
    if (predictor < 10) return data
    const bpp = Math.max(1, (colors * bpc) >> 3), rowLen = ((columns * colors * bpc) >> 3)
    const rows = Math.floor(data.length / (rowLen + 1))
    const out = new Uint8Array(rows * rowLen)
    let prev = new Uint8Array(rowLen)
    for (let r = 0; r < rows; r++) {
      const tag = data[r * (rowLen + 1)]
      const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1))
      const cur = out.subarray(r * rowLen, (r + 1) * rowLen)
      for (let i = 0; i < rowLen; i++) {
        const raw = row[i], left = i >= bpp ? cur[i - bpp] : 0, up = prev[i], ul = i >= bpp ? prev[i - bpp] : 0
        let v = raw
        if (tag === 1) v = raw + left
        else if (tag === 2) v = raw + up
        else if (tag === 3) v = raw + ((left + up) >> 1)
        else if (tag === 4) {
          const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul)
          v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)
        }
        cur[i] = v & 0xff
      }
      prev = cur
    }
    return out
  }

  /** A PDF object: dictionaries become plain objects, `/Name` becomes a string, `12 0 R` a Ref. */
  class Ref { constructor(num) { this.num = num } }

  /** Reads PDF syntax out of a byte window. Only what this file needs; strings are skipped, not decoded. */
  class Lex {
    constructor(bytes, pos = 0) { this.b = bytes; this.p = pos }
    ws() {
      for (;;) {
        while (this.p < this.b.length && WS.has(this.b[this.p])) this.p++
        if (this.b[this.p] !== 0x25) return // '%' comment
        while (this.p < this.b.length && this.b[this.p] !== 10 && this.b[this.p] !== 13) this.p++
      }
    }
    is(word) {
      this.ws()
      for (let i = 0; i < word.length; i++) if (this.b[this.p + i] !== word.charCodeAt(i)) return false
      return true
    }
    take(word) { if (!this.is(word)) return false; this.p += word.length; return true }
    name() {
      this.ws()
      if (this.b[this.p] !== 0x2f) return null
      this.p++
      let out = ''
      while (this.p < this.b.length && !WS.has(this.b[this.p]) && !DELIM.has(this.b[this.p])) {
        // '#' escapes a byte in hexadecimal inside a name.
        if (this.b[this.p] === 0x23 && this.p + 2 < this.b.length) {
          out += String.fromCharCode(parseInt(latin.decode(this.b.subarray(this.p + 1, this.p + 3)), 16))
          this.p += 3
        } else out += String.fromCharCode(this.b[this.p++])
      }
      return out
    }
    number() {
      this.ws()
      const start = this.p
      if (this.b[this.p] === 0x2b || this.b[this.p] === 0x2d) this.p++
      while (this.p < this.b.length && ((this.b[this.p] >= 48 && this.b[this.p] <= 57) || this.b[this.p] === 0x2e)) this.p++
      if (this.p === start) return null
      return Number(latin.decode(this.b.subarray(start, this.p)))
    }
    /** Any object. Returns undefined at the end of a container or on something unsupported. */
    obj() {
      this.ws()
      const c = this.b[this.p]
      if (c === undefined) return undefined
      if (c === 0x2f) return this.name()
      if (this.take('<<')) {
        const d = {}
        for (;;) {
          this.ws()
          if (this.take('>>')) return d
          const k = this.name()
          if (k === null) return d // malformed: stop rather than loop
          d[k] = this.obj()
        }
      }
      if (c === 0x5b) { // array
        this.p++
        const a = []
        for (;;) {
          this.ws()
          if (this.take(']')) return a
          if (this.p >= this.b.length) return a
          const v = this.obj()
          if (v === undefined) return a
          a.push(v)
        }
      }
      if (c === 0x28) return this.skipString()
      if (c === 0x3c) return this.skipHex()
      if (this.take('true')) return true
      if (this.take('false')) return false
      if (this.take('null')) return null
      if ((c >= 48 && c <= 57) || c === 0x2b || c === 0x2d || c === 0x2e) {
        const save = this.p
        const n = this.number()
        // "12 0 R" is a reference; anything else is just the number.
        const after = this.p
        const g = this.number()
        if (g !== null && Number.isInteger(n) && Number.isInteger(g) && this.take('R')) return new Ref(n)
        this.p = after
        if (n === null) { this.p = save + 1; return undefined }
        return n
      }
      this.p++ // unknown token: step over it rather than spin
      return undefined
    }
    skipString() {
      this.p++
      let depth = 1
      while (this.p < this.b.length && depth) {
        const c = this.b[this.p++]
        if (c === 0x5c) this.p++
        else if (c === 0x28) depth++
        else if (c === 0x29) depth--
      }
      return ''
    }
    skipHex() {
      this.p++
      while (this.p < this.b.length && this.b[this.p] !== 0x3e) this.p++
      this.p++
      return ''
    }
  }

  const OBJ_WINDOW = 65536 // enough for any image dictionary; grown once if it is not

  class Pdf {
    constructor(file) {
      this.file = file
      this.xref = new Map()   // object number → { offset } | { stm, idx }
      this.trailer = {}
      this.stmCache = new Map()
      this.objCache = new Map()
    }
    /** Bytes of the file: a PDF is read at a few precise places, never whole. */
    at(from, len) { return ISU.bytesAt(this.file, from, len) }
    async open() {
      // Granular steps: under Firefox, an error from elsewhere (another extension) arrives here WITHOUT a stack trace.
      // Only the step name indicates which operation failed — reading bytes, decoding them, or cropping.
      const tailLen = Math.min(this.file.size, 2048)
      ISU.stage('opening PDF: reading end of file')
      const tailBytes = await this.at(this.file.size - tailLen, tailLen)
      ISU.stage('opening PDF: decoding end of file')
      const tail = latin.decode(tailBytes)
      const m = tail.lastIndexOf('startxref')
      if (m < 0) throw new Error('Not a readable PDF (missing cross-reference table)')
      const start = Number((tail.slice(m + 9).match(/\d+/) || [])[0])
      if (!Number.isFinite(start)) throw new Error('Cross-reference table not found')
      const seen = new Set()
      let at = start
      while (Number.isFinite(at) && at >= 0 && !seen.has(at)) {
        seen.add(at)
        ISU.stage(`opening PDF: cross-reference table (byte ${at})`)
        at = await this.readXrefAt(at)
      }
      if (this.trailer.Encrypt) throw new Error('Encrypted PDF: password required')
      if (!this.trailer.Root) throw new Error('Incomplete PDF structure (missing catalog)')
    }
    /** Reads one cross-reference section (classic table or stream); returns the /Prev offset. */
    async readXrefAt(offset) {
      const buf = await this.at(offset, OBJ_WINDOW)
      const lex = new Lex(buf)
      if (lex.take('xref')) {
        for (;;) {
          lex.ws()
          if (lex.is('trailer')) break
          const first = lex.number(), count = lex.number()
          if (first === null || count === null) break
          lex.ws()
          for (let i = 0; i < count; i++) {
            const off = lex.number(), gen = lex.number()
            lex.ws()
            const kind = String.fromCharCode(buf[lex.p]); lex.p++
            if (kind === 'n' && !this.xref.has(first + i)) this.xref.set(first + i, { offset: off })
            void gen
          }
        }
        if (!lex.take('trailer')) return null
        const tr = lex.obj() || {}
        for (const k of Object.keys(tr)) if (!(k in this.trailer)) this.trailer[k] = tr[k]
        // A hybrid file keeps the compressed entries in /XRefStm; read it too.
        if (Number.isFinite(tr.XRefStm)) await this.readXrefAt(tr.XRefStm)
        return Number.isFinite(tr.Prev) ? tr.Prev : null
      }
      // Cross-reference stream: an ordinary object whose data is the table.
      const obj = await this.readObjectFrom(buf, offset)
      if (!obj || !obj.dict || obj.dict.Type !== 'XRef') throw new Error('Corrupted or unreadable cross-reference table')
      const data = await this.streamData(obj)
      const w = (obj.dict.W || []).map(Number)
      if (w.length < 3) throw new Error('Corrupted or unreadable cross-reference table')
      const size = Number(obj.dict.Size) || 0
      const index = obj.dict.Index && obj.dict.Index.length ? obj.dict.Index.map(Number) : [0, size]
      const rowLen = w[0] + w[1] + w[2]
      let p = 0
      for (let s = 0; s + 1 < index.length; s += 2) {
        for (let i = 0; i < index[s + 1] && p + rowLen <= data.length; i++, p += rowLen) {
          const read = (from, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + data[from + k]; return v }
          const type = w[0] ? read(p, w[0]) : 1
          const f2 = read(p + w[0], w[1]), f3 = read(p + w[0] + w[1], w[2])
          const num = index[s] + i
          if (this.xref.has(num)) continue
          if (type === 1) this.xref.set(num, { offset: f2 })
          else if (type === 2) this.xref.set(num, { stm: f2, idx: f3 })
        }
      }
      for (const k of Object.keys(obj.dict)) if (!(k in this.trailer)) this.trailer[k] = obj.dict[k]
      return Number.isFinite(obj.dict.Prev) ? obj.dict.Prev : null
    }
    /** An indirect object: its parsed dictionary and where its stream data begins, or null. */
    async object(num) {
      if (this.objCache.has(num)) return this.objCache.get(num)
      const loc = this.xref.get(num)
      if (!loc) return null
      let res = null
      if (loc.offset !== undefined) {
        let win = OBJ_WINDOW
        for (;;) {
          const buf = await this.at(loc.offset, win)
          res = await this.readObjectFrom(buf, loc.offset)
          if (res || win >= 1048576) break
          win *= 4
        }
      } else if (loc.stm !== undefined) {
        const map = await this.objectStream(loc.stm)
        res = map.get(num) || null
      }
      if (res) this.objCache.set(num, res)
      return res
    }
    async readObjectFrom(buf, origin) {
      const lex = new Lex(buf)
      const num = lex.number(), gen = lex.number()
      if (num === null || gen === null || !lex.take('obj')) return null
      const dict = lex.obj()
      lex.ws()
      let dataAt = null
      if (lex.take('stream')) {
        let p = lex.p
        if (buf[p] === 13 && buf[p + 1] === 10) p += 2
        else if (buf[p] === 10 || buf[p] === 13) p++
        dataAt = origin + p
      }
      return { num, dict, dataAt }
    }
    /** Reads an /ObjStm object stream and caches the objects packed inside it. */
    async objectStream(stmNum) {
      if (this.stmCache.has(stmNum)) return this.stmCache.get(stmNum)
      const stmObj = await this.object(stmNum)
      if (!stmObj) return new Map()
      const data = await this.streamData(stmObj)
      const count = Number(stmObj.dict.N) || 0
      const first = Number(stmObj.dict.First) || 0
      const lexHdr = new Lex(data)
      const pairs = []
      for (let i = 0; i < count; i++) {
        const num = lexHdr.number(), off = lexHdr.number()
        if (num === null || off === null) break
        pairs.push([num, off])
      }
      const map = new Map()
      this.stmCache.set(stmNum, map)
      for (const [objNum, off] of pairs) {
        const lex = new Lex(data, first + off)
        map.set(objNum, { dict: lex.obj(), dataAt: null })
      }
      return map
    }
    /** Decoded content of a stream object (Flate only — the ones this file reads are Flate or plain). */
    async streamData(obj) {
      const len = Number(await this.value(obj.dict.Length))
      if (!Number.isFinite(len)) throw new Error('Unknown stream length')
      let data = await this.at(obj.dataAt, len)
      const filters = [].concat(obj.dict.Filter || [])
      for (const f of filters) {
        if (f === 'FlateDecode') { ISU.stage(`reading PDF: decompressing stream (byte ${obj.dataAt})`); data = await ISU.inflate(data) }
        else throw new Error(`Unsupported filter (${f})`)
      }
      const parms = [].concat(obj.dict.DecodeParms || [])[0]
      const dp = parms instanceof Ref ? (await this.object(parms.num))?.dict : parms
      if (dp && Number(dp.Predictor) > 1) {
        data = unpredict(data, Number(dp.Predictor), Number(dp.Colors) || 1, Number(dp.BitsPerComponent) || 8, Number(dp.Columns) || 1)
      }
      return data
    }
    /** Follows a reference; plain values pass through. */
    async value(v) {
      if (!(v instanceof Ref)) return v
      const o = await this.object(v.num)
      return o ? o.dict : null
    }
    /**
     * The pages, in reading order, with what they inherit: resources, and the boxes that say
     * WHAT IS VISIBLE. Resources, MediaBox and CropBox are all inheritable through the page
     * tree — a page that declares none of them takes its parent's.
     */
    async pages() {
      const root = await this.value(this.trailer.Root)
      if (!root) throw new Error('Unreadable PDF catalog')
      const out = []
      const seen = new Set()
      const walk = async (node, inh, depth) => {
        if (depth > 64 || out.length > 5000) return
        if (node instanceof Ref) { if (seen.has(node.num)) return; seen.add(node.num) }
        const d = await this.value(node)
        if (!d || typeof d !== 'object') return
        const next = {
          resources: d.Resources ?? inh.resources,
          media: (await this.rect(d.MediaBox)) ?? inh.media,
          crop: (await this.rect(d.CropBox)) ?? inh.crop,
        }
        if (Array.isArray(d.Kids)) { for (const k of d.Kids) await walk(k, next, depth + 1); return }
        if (d.Type === 'Page' || d.Contents || d.MediaBox) {
          // The CropBox is what a reader displays; defaulting to MediaBox. Intersection of both per spec.
          out.push({ resources: next.resources, box: inter(next.crop, next.media) || next.media || next.crop || null, contents: d.Contents ?? null })
        }
      }
      await walk(root.Pages, { resources: null, media: null, crop: null }, 0)
      return out
    }
    /**
     * A PDF rectangle [x0 y0 x1 y1], references resolved, normalised so x0<x1 and y0<y1.
     *
     * Defensive on purpose: this is read for EVERY page, and it only serves to crop away empty
     * bands. A document whose object streams are partly unreadable must still hand back its
     * pages — losing the crop is a detail, losing the pages is not.
     */
    async rect(v) {
      try {
        const a = await this.value(v)
        if (!Array.isArray(a) || a.length !== 4) return null
        const n = []
        for (const it of a) { const x = Number(await this.value(it)); if (!Number.isFinite(x)) return null; n.push(x) }
        return { x0: Math.min(n[0], n[2]), y0: Math.min(n[1], n[3]), x1: Math.max(n[0], n[2]), y1: Math.max(n[1], n[3]) }
      } catch { return null }
    }
    /** The page's content stream, decompressed and concatenated (a page may split it in parts). */
    async content(ref) {
      try { return await this._content(ref) } catch { return null } // same reason as rect
    }
    async _content(ref) {
      const parts = []
      const list = ref instanceof Ref ? [ref] : Array.isArray(ref) ? ref : ref ? [ref] : []
      for (const it of list.slice(0, 32)) {
        if (!(it instanceof Ref)) continue
        const o = await this.object(it.num)
        if (!o) continue
        try { parts.push(await this.streamData(o)) } catch { /* unreadable stream: others remain */ }
      }
      if (!parts.length) return null
      let n = 0
      for (const p of parts) n += p.length + 1
      const all = new Uint8Array(n)
      let at = 0
      for (const p of parts) { all.set(p, at); at += p.length; all[at++] = 32 }
      return all
    }
  }

  /**
   * The JPEG of each page, as a slice of the PDF — nothing decompressed, nothing re-encoded.
   * Throws when the document cannot be read at all; a page that is not a single JPEG is skipped
   * and named in `skipped`, so the caller can say exactly what was left out.
   */
  /** Intersection of two PDF rectangles; either may be missing. */
  const inter = (a, b) => {
    if (!a) return b || null
    if (!b) return a
    const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : b
  }

  /**
   * The matrix under which the XObject `key` is drawn, by replaying the content stream's
   * graphics state. Only `q`, `Q` and `cm` change it; everything else is stepped over. Strings
   * are skipped so that text can never be mistaken for an operator.
   *
   * Returns [a, b, c, d, e, f], or null when the image is not drawn (or drawn in a form we do
   * not follow — in which case the caller simply does not crop).
   */
  function placementOf(bytes, key) {
    const text = new TextDecoder('latin1').decode(bytes)
    const mul = (m, n) => [
      m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
    ]
    let ctm = [1, 0, 0, 1, 0, 0]
    const stack = []
    let nums = [], name = null
    const re = /\((?:\[\s\S]|[^\)])*\)|<[^>]*>|%[^\r\n]*|\/([^\s\/<>\[\](){}%]+)|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)|([A-Za-z'"*]+)/g
    let m
    while ((m = re.exec(text))) {
      if (m[1] !== undefined) { name = m[1]; continue }
      if (m[2] !== undefined) { nums.push(Number(m[2])); if (nums.length > 6) nums.shift(); continue }
      if (m[3] === undefined) continue // string, comment: no effect here
      const op = m[3]
      if (op === 'q') stack.push(ctm.slice())
      else if (op === 'Q') ctm = stack.pop() || ctm
      else if (op === 'cm' && nums.length === 6) ctm = mul(nums, ctm)
      else if (op === 'Do' && name === key) return ctm
      nums = []
    }
    return null
  }

  /**
   * Which part of a `W`×`H` image is actually VISIBLE on the page — the answer the PDF itself
   * gives, in the image's own pixels.
   *
   * A digital edition draws a screen-sized image and shows only the middle of it: the empty
   * bands and the reader's widget fall outside the page box. Reading that box beats any attempt
   * to recognise the bands by their look, and it is exact.
   *
   * Only an upright placement is followed (no rotation, no mirroring): anything else returns
   * null and the whole image is kept, rather than cropping on a guess.
   */
  function visiblePart(ctm, box, W, H) {
    if (!ctm || !box) return null
    const [a, b, c, d, e, f] = ctm
    const span = Math.max(Math.abs(a), Math.abs(d))
    if (Math.abs(b) > span * 1e-6 || Math.abs(c) > span * 1e-6) return null // rotated or skewed
    if (!(Math.abs(a) > 1e-9 && Math.abs(d) > 1e-9)) return null
    // u, v: coordinates in the image (unit), v = 0 at the bottom. Row 0 is at v = 1.
    const us = [(box.x0 - e) / a, (box.x1 - e) / a].sort((p, q) => p - q)
    const vs = [(box.y0 - f) / d, (box.y1 - f) / d].sort((p, q) => p - q)
    const x0 = Math.max(0, us[0] * W), x1 = Math.min(W, us[1] * W)
    const y0 = Math.max(0, (1 - vs[1]) * H), y1 = Math.min(H, (1 - vs[0]) * H)
    if (!(x1 > x0 && y1 > y0)) return null
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  ISU.pdfImages = async function pdfImages(file) {
    const doc = new Pdf(file)
    ISU.stage('opening PDF')
    await doc.open()
    ISU.stage('reading page tree')
    const pages = await doc.pages()
    if (!pages.length) throw new Error('No pages found in this PDF')
    const base = file.name.replace(/\.[^.]+$/, '')
    const files = [], skipped = []
    const boxes = new Map() // file → visible part on page, or null
    for (let i = 0; i < pages.length; i++) {
      ISU.stage(`page ${i + 1}/${pages.length}: resources`)
      const res = await doc.value(pages[i].resources)
      const xo = await doc.value(res?.XObject)
      const images = []
      for (const key of Object.keys(xo || {})) {
        const ref = xo[key]
        if (!(ref instanceof Ref)) continue
        const obj = await doc.object(ref.num)
        if (!obj?.dict || obj.dict.Subtype !== 'Image' || obj.dict.ImageMask === true) continue
        images.push({ obj, key })
      }
      if (images.length !== 1) { skipped.push(`p${i + 1} (${images.length} image${images.length > 1 ? 's' : ''})`); continue }
      const { obj: img, key } = images[0]
      const filters = [].concat(img.dict.Filter || [])
      if (filters.length !== 1 || filters[0] !== 'DCTDecode') {
        skipped.push(`p${i + 1} (${filters.join('+') || 'uncompressed'})`)
        continue
      }
      const len = Number(await doc.value(img.dict.Length))
      if (!Number.isFinite(len) || len <= 0 || img.dataAt === null || img.dataAt + len > file.size) { skipped.push(`p${i + 1} (unreadable stream)`); continue }
      // Last check, and the decisive one: the bytes really begin a JPEG.
      const head = await doc.at(img.dataAt, 2)
      if (head[0] !== 0xff || head[1] !== 0xd8) { skipped.push(`p${i + 1} (unexpected data)`); continue }
      const name = `${base}_p${String(i + 1).padStart(3, '0')}.jpg`
      ISU.stage(`page ${i + 1}/${pages.length}: extracting JPEG`)
      const out = await ISU.fileFrom(file, img.dataAt, len, name, 'image/jpeg')
      // What the page SHOWS of this image. Digital editions draw screen-sized images and display only the middle.
      let visible = null
      ISU.stage(`page ${i + 1}/${pages.length}: displayed geometry`)
      try {
        const W = Number(await doc.value(img.dict.Width)), H = Number(await doc.value(img.dict.Height))
        if (W > 0 && H > 0 && pages[i].box) {
          const content = await doc.content(pages[i].contents)
          const part = content ? visiblePart(placementOf(content, key), pages[i].box, W, H) : null
          // A part covering almost everything is not worth cropping.
          if (part && (part.w < W - 1 || part.h < H - 1)) visible = { ...part, imageW: W, imageH: H }
        }
      } catch { /* unreadable geometry: full page kept */ }
      boxes.set(out, visible)
      files.push(out)
    }
    if (!files.length) {
      throw new Error(`No usable JPEG pages found (${pages.length} page${pages.length > 1 ? 's' : ''}: ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''})`)
    }
    ISU.stage('PDF extraction complete')
    return { files, skipped, pages: pages.length, visible: boxes }
  }
})()

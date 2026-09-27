// Cutting a rectangle out of a JPEG WITHOUT re-encoding it.
//
// A canvas crop decodes the image and encodes it again: one more JPEG generation lost, on every
// entry, for ever. Yet a JPEG is already a grid of independently coded 8×8 blocks — so a
// rectangle aligned on that grid can be cut by copying the coefficients as they are. The pixels
// that come out are then bit-for-bit those that went in. This is what `jpegtran -crop` does.
//
// The price is one corner only: the cut STARTS on the block grid (8 pixels per component, so 16
// with the usual 4:2:0 chroma subsampling), because that is where the coefficient stream is
// re-read from. Its width and height are free to the pixel — a JPEG's last MCU may be partly
// used, which is how any size is representable at all. On the scan of a page a corner rounded by
// at most 15 pixels is invisible, and it is the only way to honour the rule that nothing we
// upload may ever lose quality.
//
// Only baseline sequential Huffman JPEG is handled: it is what scanners and comic archives
// produce. Anything else (progressive, arithmetic coding, 12-bit) is refused by name rather than
// mangled, and the caller falls back on asking a human.
;(() => {
  const ISU = window.ISU

  const M = { SOI: 0xd8, EOI: 0xd9, SOS: 0xda, DQT: 0xdb, DNL: 0xdc, DRI: 0xdd, DHT: 0xc4, APP0: 0xe0, COM: 0xfe }
  const isSOF = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
  const isRST = (m) => m >= 0xd0 && m <= 0xd7

  /** Reads the markers of a JPEG: what has to be understood, and what is merely carried over. */
  function parse(b) {
    if (b[0] !== 0xff || b[1] !== M.SOI) throw new Error('ce n’est pas un JPEG')
    const out = { segments: [], frame: null, scan: null, dri: 0, huff: new Map() }
    let p = 2
    while (p < b.length) {
      if (b[p] !== 0xff) { p++; continue }
      let m = b[p + 1]
      while (m === 0xff) { p++; m = b[p + 1] } // fill bytes
      if (m === M.EOI) break
      const start = p
      p += 2
      if (m === 0x01 || isRST(m)) { out.segments.push({ marker: m, start, end: p }); continue }
      const len = (b[p] << 8) | b[p + 1]
      const body = p + 2, bodyEnd = p + len
      if (isSOF(m)) {
        if (m !== 0xc0 && m !== 0xc1) {
          throw new Error(m === 0xc2 ? 'JPEG progressif : rognage sans perte impossible' : 'variante de JPEG non gérée')
        }
        if (b[body] !== 8) throw new Error('JPEG non 8 bits')
        const comps = []
        const n = b[body + 5]
        for (let i = 0; i < n; i++) {
          const o = body + 6 + i * 3
          comps.push({ id: b[o], h: b[o + 1] >> 4, v: b[o + 1] & 15, tq: b[o + 2] })
        }
        out.frame = { marker: m, h: (b[body + 1] << 8) | b[body + 2], w: (b[body + 3] << 8) | b[body + 4], comps, start, end: bodyEnd }
      } else if (m === M.DHT) {
        for (let o = body; o < bodyEnd;) {
          const tc = b[o] >> 4, th = b[o] & 15
          const counts = b.subarray(o + 1, o + 17)
          let total = 0
          for (let i = 0; i < 16; i++) total += counts[i]
          out.huff.set(tc * 16 + th, buildHuff(counts, b.subarray(o + 17, o + 17 + total)))
          o += 17 + total
        }
        out.segments.push({ marker: m, start, end: bodyEnd })
      } else if (m === M.DRI) {
        out.dri = (b[body] << 8) | b[body + 1]
        out.segments.push({ marker: m, start, end: bodyEnd, skip: true }) // re-encoded without restarts
      } else if (m === M.SOS) {
        const n = b[body]
        const comps = []
        for (let i = 0; i < n; i++) comps.push({ id: b[body + 1 + i * 2], td: b[body + 2 + i * 2] >> 4, ta: b[body + 2 + i * 2] & 15 })
        // The entropy-coded data runs until the next marker that is neither a stuffed 0x00 nor a restart.
        let e = bodyEnd
        while (e < b.length - 1 && !(b[e] === 0xff && b[e + 1] !== 0 && !isRST(b[e + 1]))) e++
        out.scan = { comps, start, headerEnd: bodyEnd, dataStart: bodyEnd, dataEnd: e }
        p = e
        continue
      } else {
        out.segments.push({ marker: m, start, end: bodyEnd })
      }
      p = bodyEnd
    }
    if (!out.frame || !out.scan) throw new Error('JPEG incomplet')
    if (out.frame.comps.length !== out.scan.comps.length) throw new Error('JPEG à plusieurs passes : rognage sans perte impossible')
    return out
  }

  /** Canonical Huffman tables, in both directions: one to read the file, one to write it back. */
  function buildHuff(counts, values) {
    const codes = [], sizes = []
    let code = 0, k = 0
    for (let l = 1; l <= 16; l++) {
      for (let i = 0; i < counts[l - 1]; i++) { codes[k] = code++; sizes[k] = l; k++ }
      code <<= 1
    }
    const maxcode = new Int32Array(18).fill(-1), mincode = new Int32Array(18), valptr = new Int32Array(18)
    let idx = 0
    for (let l = 1; l <= 16; l++) {
      if (counts[l - 1]) {
        valptr[l] = idx
        mincode[l] = codes[idx]
        idx += counts[l - 1]
        maxcode[l] = codes[idx - 1]
      }
    }
    const enc = new Map()
    for (let i = 0; i < k; i++) enc.set(values[i], { code: codes[i], size: sizes[i] })
    return { maxcode, mincode, valptr, values, enc }
  }

  /** Reads bits MSB first, stepping over the 0x00 that follows every 0xFF in the data. */
  class Bits {
    constructor(b, at, end) { this.b = b; this.p = at; this.end = end; this.buf = 0; this.n = 0 }
    bit() {
      if (this.n === 0) {
        if (this.p >= this.end) return 0
        let v = this.b[this.p++]
        if (v === 0xff) { const next = this.b[this.p]; if (next === 0) this.p++; else if (isRST(next)) { this.p++; v = this.b[this.p++] } }
        this.buf = v; this.n = 8
      }
      this.n--
      return (this.buf >> this.n) & 1
    }
    bits(count) { let v = 0; for (let i = 0; i < count; i++) v = (v << 1) | this.bit(); return v }
    align() { this.n = 0 }
    /** Steps over a restart marker, which also resets the differential coding of the DC terms. */
    restart() {
      this.align()
      while (this.p < this.end - 1 && !(this.b[this.p] === 0xff && isRST(this.b[this.p + 1]))) this.p++
      if (this.p < this.end - 1) this.p += 2
    }
  }

  function decodeHuff(bits, table) {
    let code = bits.bit(), l = 1
    while (l <= 16 && (table.maxcode[l] < 0 || code > table.maxcode[l])) { code = (code << 1) | bits.bit(); l++ }
    if (l > 16) return 0
    return table.values[table.valptr[l] + code - table.mincode[l]]
  }
  const extend = (v, t) => (t === 0 ? 0 : v < 1 << (t - 1) ? v - (1 << t) + 1 : v)
  const magnitude = (v) => { let a = Math.abs(v), n = 0; while (a) { a >>= 1; n++ } return n }

  /** Writes bits MSB first, and protects every 0xFF with the 0x00 the format requires. */
  class Out {
    constructor() { this.a = []; this.buf = 0; this.n = 0 }
    write(code, size) {
      for (let i = size - 1; i >= 0; i--) {
        this.buf = (this.buf << 1) | ((code >> i) & 1)
        if (++this.n === 8) {
          this.a.push(this.buf)
          if (this.buf === 0xff) this.a.push(0)
          this.buf = 0; this.n = 0
        }
      }
    }
    flush() { while (this.n) this.write(1, 1) } // padded with ones, as the format asks
  }

  /**
   * The Huffman table that codes THIS histogram in the fewest bits, as the JPEG standard's
   * Annex K describes it: build the tree by repeatedly merging the two least frequent symbols,
   * then bring any code longer than 16 bits back into range (the format allows no more), then
   * lay the codes out canonically — shortest first, and by symbol within a length.
   *
   * One symbol is reserved with a count of 1 and dropped at the end: it guarantees that no real
   * symbol receives the all-ones code, which a decoder is allowed to treat as padding.
   *
   * Returns { bits (counts per length 1..16), values, enc } — `enc` maps a symbol to its code.
   */
  function optimalTable(freqIn) {
    const f = Int32Array.from(freqIn)
    f[256] = 1 // le symbole réservé
    const size = new Int32Array(257)
    const chain = new Int32Array(257).fill(-1)
    for (;;) {
      // Les deux plus petites fréquences non nulles ; à égalité, le plus grand indice — c'est ce
      // que fait libjpeg, et cela rend le résultat reproductible.
      let v1 = -1, v2 = -1
      for (let i = 0; i <= 256; i++) if (f[i] && (v1 < 0 || f[i] < f[v1] || (f[i] === f[v1] && i > v1))) v1 = i
      for (let i = 0; i <= 256; i++) if (f[i] && i !== v1 && (v2 < 0 || f[i] < f[v2] || (f[i] === f[v2] && i > v2))) v2 = i
      if (v2 < 0) break
      f[v1] += f[v2]; f[v2] = 0
      // Chaque symbole de la branche fusionnée gagne un bit ; la chaîne se raccroche à la QUEUE
      // de la première branche, pas à sa tête — l'accrocher à la tête casse l'arbre.
      let k = v1
      size[k]++
      while (chain[k] >= 0) { k = chain[k]; size[k]++ }
      chain[k] = v2
      k = v2
      size[k]++
      while (chain[k] >= 0) { k = chain[k]; size[k]++ }
    }
    const bits = new Int32Array(33)
    for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++
    // Aucun code ne peut dépasser 16 bits : on rééquilibre l'arbre sans changer son contenu.
    for (let i = 32; i > 16; i--) {
      while (bits[i] > 0) {
        let j = i - 2
        while (bits[j] === 0) j--
        bits[i] -= 2
        bits[i - 1] += 1
        bits[j + 1] += 2
        bits[j] -= 1
      }
    }
    let last = 16
    while (last > 0 && bits[last] === 0) last--
    bits[last]-- // on retire le symbole réservé
    const counts = new Uint8Array(16)
    for (let i = 1; i <= 16; i++) counts[i - 1] = bits[i]
    // Les symboles rangés par leur longueur D'ORIGINE puis par valeur : c'est cet ordre que les
    // longueurs ramenées à 16 bits viennent recouvrir. S'arrêter à 16 ici perdait les symboles
    // des branches profondes — et le fichier ne se décodait plus.
    const values = []
    for (let len = 1; len <= 32; len++) for (let i = 0; i < 256; i++) if (size[i] === len) values.push(i)
    let total = 0
    for (let i = 0; i < 16; i++) total += counts[i]
    if (total > values.length) throw new Error('table de Huffman incohérente')
    const enc = new Map()
    let code = 0, at = 0
    for (let len = 1; len <= 16; len++) {
      for (let n = 0; n < counts[len - 1]; n++) enc.set(values[at++], { code: code++, size: len })
      code <<= 1
    }
    return { counts, values: values.slice(0, at), enc }
  }

  /**
   * The rectangle brought onto the block grid — the only freedom a lossless cut leaves.
   *
   * ONLY THE ORIGIN IS CONSTRAINED. The first kept block must be a whole MCU (8 pixels per
   * component, so 16 with the usual 4:2:0 chroma) because that is where the coefficient stream
   * is re-read from. The right and bottom edges are free to the pixel: a JPEG's last MCU may be
   * only partly used — that is how any width becomes representable — so the frame header simply
   * declares the exact size and the decoder drops the padding. Rounding those two sides as well
   * used to cost up to 15 pixels of someone else's drawing for nothing.
   *
   * On the two sides that ARE constrained, the DIRECTION of the rounding is still ours: widening
   * over a blank margin costs nothing and keeps every last pixel of the entry, while widening
   * over the neighbour's drawing would hand someone else's art to this entry — so that side
   * retracts instead. `blank(strip)` answers whether the strip that widening would add is empty
   * paper; without it, both widen, which is the safe default for content but not for neighbours.
   */
  function snap(parsed, rect, { blank = null } = {}) {
    const { w, h, comps } = parsed.frame
    const hMax = Math.max(...comps.map((c) => c.h)), vMax = Math.max(...comps.map((c) => c.v))
    const mw = 8 * hMax, mh = 8 * vMax
    const rx1 = rect.x + rect.w, ry1 = rect.y + rect.h
    // Widening moves the edge towards 0, so the strip it adds lies before the rectangle.
    const wide = (v, step) => Math.max(0, Math.floor(v / step) * step)
    const tight = (v, step) => Math.ceil(v / step) * step
    let x0 = wide(rect.x, mw), y0 = wide(rect.y, mh)
    if (blank) {
      if (!blank({ x: x0, y: rect.y, w: rect.x - x0, h: rect.h })) x0 = Math.min(tight(rect.x, mw), w - mw)
      if (!blank({ x: rect.x, y: y0, w: rect.w, h: rect.y - y0 })) y0 = Math.min(tight(rect.y, mh), h - mh)
    }
    // Le départ DOIT rester un multiple de la grille : l'index du MCU s'en déduit par division.
    // Une image dont la largeur n'est pas un multiple (1620 pour une grille de 16) rendait ici un
    // x non aligné, donc un index fractionnaire et des blocs lus de travers.
    const onGrid = (v, step, max) => Math.max(0, Math.min(Math.floor(v / step) * step, Math.floor((max - 1) / step) * step))
    x0 = onGrid(x0, mw, w); y0 = onGrid(y0, mh, h)
    // Kept exactly as asked: those two edges cost nothing to the format.
    const x1 = Math.min(w, Math.max(rx1, x0 + 1)), y1 = Math.min(h, Math.max(ry1, y0 + 1))
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, mw, mh }
  }

  /**
   * The DCT coefficients of the MCUs covered by `box`, in the order they are coded.
   *
   * The whole stream is walked — it is sequential, there is no index — but only the blocks of
   * the rectangle are kept: a page would otherwise cost tens of megabytes of coefficients.
   */
  function readBlocks(b, parsed, mx0, my0, outX, outY) {
    const { frame, scan, dri, huff } = parsed
    const hMax = Math.max(...frame.comps.map((c) => c.h)), vMax = Math.max(...frame.comps.map((c) => c.v))
    const mcusX = Math.ceil(frame.w / (8 * hMax)), mcusY = Math.ceil(frame.h / (8 * vMax))
    const kept = new Array(outX * outY).fill(null)
    const bits = new Bits(b, scan.dataStart, scan.dataEnd)
    const pred = new Int32Array(frame.comps.length)
    let sinceRestart = 0
    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        if (dri && sinceRestart === dri) { bits.restart(); pred.fill(0); sinceRestart = 0 }
        sinceRestart++
        const inside = mx >= mx0 && mx < mx0 + outX && my >= my0 && my < my0 + outY
        const cell = inside ? [] : null
        for (let ci = 0; ci < frame.comps.length; ci++) {
          const comp = frame.comps[ci], sc = scan.comps[ci]
          const dcT = huff.get(sc.td), acT = huff.get(16 + sc.ta)
          if (!dcT || !acT) throw new Error('table de Huffman manquante')
          for (let by = 0; by < comp.v; by++) {
            for (let bx = 0; bx < comp.h; bx++) {
              // Coefficients are kept in the order they are coded: re-encoded the same way, they
              // never need to be reordered — one fewer place to get it wrong.
              const blk = new Int16Array(64)
              const t = decodeHuff(bits, dcT)
              pred[ci] += extend(bits.bits(t), t)
              blk[0] = pred[ci]
              for (let k = 1; k < 64;) {
                const rs = decodeHuff(bits, acT)
                const s = rs & 15, r = rs >> 4
                if (s === 0) { if (r === 15) { k += 16; continue } break }
                k += r
                if (k > 63) break
                blk[k++] = extend(bits.bits(s), s)
              }
              if (cell) cell.push(blk)
            }
          }
        }
        if (cell) kept[(my - my0) * outX + (mx - mx0)] = cell
      }
    }
    return kept
  }

  /**
   * `bytes` (a JPEG) cut to `rect`, as a new JPEG. The coefficients are copied, never recomputed:
   * decoding the result gives exactly the pixels of that region of the original.
   */
  function crop(bytes, rect, { keepMeta = false } = {}) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const parsed = parse(b)
    const { frame, scan, dri, huff } = parsed
    const box = snap(parsed, rect, { blank: rect.blank || null })
    const hMax = Math.max(...frame.comps.map((c) => c.h)), vMax = Math.max(...frame.comps.map((c) => c.v))
    const mcusX = Math.ceil(frame.w / (8 * hMax)), mcusY = Math.ceil(frame.h / (8 * vMax))
    const mx0 = box.x / box.mw, my0 = box.y / box.mh
    const outX = Math.ceil(box.w / box.mw), outY = Math.ceil(box.h / box.mh)

    const kept = readBlocks(b, parsed, mx0, my0, outX, outY)

    // ── Writing: the same coefficients, with Huffman tables computed FOR THEM ──
    // Only the DC differences change (the first block of the cut no longer follows the one it
    // used to). Reusing the source's tables was simpler, but they were built for the whole page:
    // recomputing them for the cut costs nothing in quality — the coefficients are untouched —
    // saves about 2 % of the file, and removes a real failure: a value of the cut falling
    // outside tables that never had to describe it.
    //
    // The stream is walked twice: once to count the symbols, once to write them. Nothing is
    // stored in between — the coefficients are already in memory, and counting is free.
    const walk = (onSym) => {
      const pred = new Int32Array(frame.comps.length)
      for (let my = 0; my < outY; my++) {
        for (let mx = 0; mx < outX; mx++) {
          const cell = kept[my * outX + mx]
          if (!cell) throw new Error('rognage hors de l’image')
          let bi = 0
          for (let ci = 0; ci < frame.comps.length; ci++) {
            const comp = frame.comps[ci], sc = scan.comps[ci]
            for (let n = 0; n < comp.h * comp.v; n++) {
              const blk = cell[bi++]
              const diff = blk[0] - pred[ci]
              pred[ci] = blk[0]
              const t = magnitude(diff)
              onSym(sc.td, t, t ? (diff < 0 ? diff + (1 << t) - 1 : diff) : 0, t)
              let run = 0
              for (let k = 1; k < 64; k++) {
                if (blk[k] === 0) { run++; continue }
                while (run > 15) { onSym(16 + sc.ta, 0xf0, 0, 0); run -= 16 }
                const s = magnitude(blk[k])
                onSym(16 + sc.ta, (run << 4) | s, blk[k] < 0 ? blk[k] + (1 << s) - 1 : blk[k], s)
                run = 0
              }
              if (run) onSym(16 + sc.ta, 0, 0, 0)
            }
          }
        }
      }
    }
    const freq = new Map()
    walk((id, sym) => {
      let f = freq.get(id)
      if (!f) { f = new Int32Array(257); freq.set(id, f) }
      f[sym]++
    })
    const tables = new Map()
    for (const [id, f] of freq) tables.set(id, optimalTable(f))
    const out = new Out()
    walk((id, sym, extra, len) => {
      const c = tables.get(id).enc.get(sym)
      out.write(c.code, c.size)
      if (len) out.write(extra, len)
    })
    out.flush()

    // ── The file: every segment carried over as it is, the frame given its new size, the scan
    // replaced. The restart interval is dropped since the new stream has no restarts.
    const parts = [new Uint8Array([0xff, M.SOI])]
    for (const seg of parsed.segments) {
      // Les tables de Huffman d'origine ne servent plus : celles du fichier de sortie sont
      // calculées pour son propre contenu, et sont écrites juste avant le balayage.
      if (seg.skip || seg.marker === M.SOI || seg.marker === M.DHT) continue
      // EXIF, XMP, Photoshop, commentaires : rien à voir avec l'image, et tout à voir avec toi.
      // « keepMeta » les laisse passer pour qui les veut — le choix est à l'envoi, pas ici.
      if (!keepMeta && isPrivate(b, seg)) continue
      parts.push(b.subarray(seg.start, seg.end))
    }
    // La seule chose que l'EXIF portait et qui compte : l'orientation, qu'Inducks applique.
    // (Inutile quand on garde tout : l'EXIF d'origine est déjà là, et l'écrire deux fois donnerait
    // un fichier à deux blocs EXIF, que les décodeurs interprètent chacun à leur façon.)
    if (!keepMeta) {
      const turn = orientationOf(b, parsed)
      if (turn > 1) parts.push(orientationSegment(turn))
      else if (turn === -1) for (const seg of parsed.segments) { if (seg.marker === 0xe1) parts.push(b.subarray(seg.start, seg.end)) }
    }
    for (const [id, t] of tables) {
      const len = 2 + 1 + 16 + t.values.length
      const dht = new Uint8Array(2 + len)
      dht[0] = 0xff; dht[1] = M.DHT
      dht[2] = (len >> 8) & 0xff; dht[3] = len & 0xff
      dht[4] = id >= 16 ? 0x10 | (id - 16) : id // classe (DC/AC) et numéro de table
      dht.set(t.counts, 5)
      dht.set(t.values, 21)
      parts.push(dht)
    }
    const sof = b.slice(frame.start, frame.end)
    sof[5] = (box.h >> 8) & 0xff; sof[6] = box.h & 0xff
    sof[7] = (box.w >> 8) & 0xff; sof[8] = box.w & 0xff
    parts.push(sof)
    parts.push(b.subarray(scan.start, scan.headerEnd))
    parts.push(new Uint8Array(out.a))
    parts.push(new Uint8Array([0xff, M.EOI]))
    const size = parts.reduce((n, p) => n + p.length, 0)
    const file = new Uint8Array(size)
    let at = 0
    for (const p of parts) { file.set(p, at); at += p.length }
    return { bytes: file, box: { x: box.x, y: box.y, w: box.w, h: box.h } }
  }

  /** The grid the cut snaps to, in pixels — what the confirmation screen needs to draw it. */
  function grid(bytes) {
    const frame = parse(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).frame
    return { w: 8 * Math.max(...frame.comps.map((c) => c.h)), h: 8 * Math.max(...frame.comps.map((c) => c.v)), imageW: frame.w, imageH: frame.h }
  }

  /**
   * Which of the file's non-image segments follow it into the output.
   *
   * A JPEG can carry far more than the picture: the camera or scanner's EXIF (device, serial
   * number, dates, sometimes GPS), an XMP block, Photoshop's own leftovers, free comments. None
   * of that changes a pixel, and all of it would end up in a public archive. Since the file is
   * rewritten anyway, it costs nothing to leave it behind.
   *
   * What IS kept is what a decoder needs: JFIF (density), the ICC profile (colours), Adobe's
   * APP14 (colour transform). And the one thing EXIF is needed for — the ORIENTATION, which
   * Inducks' own `mogrify -auto-orient` acts on — is re-emitted alone, in a minimal block.
   */
  const XMP = 'http://ns.adobe.com/xap/1.0/'
  function isPrivate(b, seg) {
    const m = seg.marker
    if (m === M.COM || m === 0xeb || m === 0xec || m === 0xed || m === 0xef) return true // commentaire, Ducky, Photoshop…
    if (m === 0xe1) return true // EXIF ou XMP : remplacé par l'orientation seule
    if (m >= 0xe3 && m <= 0xea) return true // APP3..APP10 : Meta, données propriétaires
    return false
  }
  /** L'orientation EXIF du fichier, s'il en porte une autre que « normale ». */
  function orientationOf(b, parsed) {
    for (const seg of parsed.segments) {
      if (seg.marker !== 0xe1) continue
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
      try {
        // Sans lecteur d'EXIF disponible, on préfère GARDER le bloc plutôt que perdre en silence
        // une orientation : c'est le seul cas où la confidentialité cède devant l'exactitude.
        if (!ISU.exifOrientation) return -1
        const o = ISU.exifOrientation(b, dv, seg.start + 4, seg.end)
        if (o > 1) return o
      } catch { /* EXIF illisible : rien à conserver */ }
    }
    return 1
  }
  /** Un APP1 minimal ne portant que l'orientation : 34 octets, aucune autre information. */
  function orientationSegment(value) {
    const a = new Uint8Array(36)
    const dv = new DataView(a.buffer)
    a[0] = 0xff; a[1] = 0xe1
    dv.setUint16(2, 34)
    a.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4) // "Exif" + 2 zeros
    a.set([0x4d, 0x4d], 10)                  // gros-boutiste
    dv.setUint16(12, 42); dv.setUint32(14, 8)
    dv.setUint16(18, 1)                      // une seule entrée
    dv.setUint16(20, 0x0112); dv.setUint16(22, 3); dv.setUint32(24, 1); dv.setUint16(28, value)
    dv.setUint32(32, 0)                      // pas d'IFD suivant
    return a
  }

  /**
   * The same image, encoded with Huffman tables built for IT — nothing else changes.
   *
   * Many scans, and most comic archives, carry the standard tables printed in the JPEG norm:
   * they describe an average image, not this one. Recomputing them costs a sixth of the file on
   * a CBR page and a couple of percent on an already well-encoded scan, for exactly the same
   * pixels: the DCT coefficients are copied, only their codes change.
   *
   * The result is VERIFIED before being handed back — decoded again and compared coefficient by
   * coefficient with the original. An encoder bug would be silent otherwise, and these bytes go
   * into a public archive. That doubles the cost (about a third of a second per page either way)
   * and buys certainty per file rather than confidence in general.
   *
   * Returns null when there is nothing to gain, so the caller keeps the file it already has.
   */
  function optimise(bytes, { keepMeta = false } = {}) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const parsed = parse(b)
    const { frame } = parsed
    const hMax = Math.max(...frame.comps.map((c) => c.h)), vMax = Math.max(...frame.comps.map((c) => c.v))
    const outX = Math.ceil(frame.w / (8 * hMax)), outY = Math.ceil(frame.h / (8 * vMax))
    const out = crop(b, { x: 0, y: 0, w: frame.w, h: frame.h }, { keepMeta })
    if (out.bytes.length >= b.length) return null
    const before = readBlocks(b, parsed, 0, 0, outX, outY)
    const after = readBlocks(out.bytes, parse(out.bytes), 0, 0, outX, outY)
    if (before.length !== after.length) throw new Error('optimisation : nombre de blocs différent')
    for (let i = 0; i < before.length; i++) {
      const p = before[i], q = after[i]
      if (!p || !q || p.length !== q.length) throw new Error('optimisation : blocs manquants')
      for (let n = 0; n < p.length; n++) {
        const u = p[n], v = q[n]
        for (let k = 0; k < 64; k++) if (u[k] !== v[k]) throw new Error('optimisation : coefficient modifié')
      }
    }
    return out.bytes
  }

  ISU.jpegCrop = { parse, optimise, crop, snap, grid }
})()

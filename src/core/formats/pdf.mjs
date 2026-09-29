import { inflateRawSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { createIsu, loadCore, formatOutputName, DEFAULT_OUTPUT_NAME_TEMPLATE } from '../../../convert-pdf-to-jpg/package/src/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageSrcDir = path.resolve(__dirname, '../../../convert-pdf-to-jpg/package/src');

export const isu = createIsu({
  async inflate(bytes) {
    try {
      return new Uint8Array(inflateSync(bytes));
    } catch (zlibError) {
      try {
        return new Uint8Array(inflateRawSync(bytes));
      } catch {
        throw zlibError;
      }
    }
  },
  async bytesAt(file, from, len) {
    return new Uint8Array(await file.slice(from, from + len).arrayBuffer());
  },
  exifOrientation(bytes, view, from, to) {
    if (to - from < 14 || view.getUint32(from) !== 0x45786966 || view.getUint16(from + 4) !== 0) return 1;
    const tiff = from + 6;
    const littleEndian = view.getUint16(tiff) === 0x4949;
    const u16 = (offset) => view.getUint16(offset, littleEndian);
    const u32 = (offset) => view.getUint32(offset, littleEndian);
    if (u16(tiff + 2) !== 42) return 1;
    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > to) return 1;
    for (let i = 0, count = u16(ifd); i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > to) break;
      if (u16(entry) === 0x0112) {
        const orientation = u16(entry + 8);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    return 1;
  },
});

loadCore(
  isu,
  (filename) => readFileSync(path.join(packageSrcDir, filename), 'utf8'),
  (code, filename) => vm.runInThisContext(code, { filename }),
);

export { formatOutputName, DEFAULT_OUTPUT_NAME_TEMPLATE };

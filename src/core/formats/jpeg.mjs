/**
 * 100% Mathematical Lossless JPEG Cleaner
 * Strips non-essential APP markers (EXIF, IPTC, comments) without touching DCT coefficients or pixel data.
 *
 * @param {Buffer} buf Raw JPEG Buffer
 * @returns {Buffer} Cleaned Lossless JPEG Buffer
 */
export function cleanJpegLossless(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) {
    return buf;
  }

  const chunks = [Buffer.from([0xFF, 0xD8])];
  let offset = 2;

  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xFF) {
      chunks.push(buf.subarray(offset));
      break;
    }

    const marker = buf[offset + 1];

    // Start of Spectral Scan (0xDA): Image payload starts here
    if (marker === 0xDA) {
      chunks.push(buf.subarray(offset));
      break;
    }

    // Standalone markers without payload length
    if (marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      chunks.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > buf.length) break;
    const len = buf.readUInt16BE(offset + 2);

    // Strip APP1..APP15 metadata & Comments (0xFE), preserve standard APP0 (JFIF)
    const isAppOrComment = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE;
    if (!isAppOrComment) {
      chunks.push(buf.subarray(offset, offset + 2 + len));
    }

    offset += 2 + len;
  }

  return Buffer.concat(chunks);
}

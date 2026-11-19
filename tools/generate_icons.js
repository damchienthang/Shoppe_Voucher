import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.join(__dirname, '..', 'assets');

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// CRC32 table for valid PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function createPng(width, height, samplePixel) {
  const bytesPerPixel = 4;
  const scanlineLength = width * bytesPerPixel + 1;
  const rawData = Buffer.alloc(height * scanlineLength);
  const samples = 4; // 4x4 supersampling for crisp anti-aliased edges

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0;

    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / width;
          const v = (y + (sy + 0.5) / samples) / height;
          const [r, g, b, a] = samplePixel(u, v);
          const alpha = a / 255;
          rSum += r * alpha;
          gSum += g * alpha;
          bSum += b * alpha;
          aSum += alpha;
        }
      }

      const count = samples * samples;
      const avgAlpha = aSum / count;
      const pxOffset = rowOffset + 1 + x * bytesPerPixel;
      if (avgAlpha > 0) {
        rawData[pxOffset] = Math.round(rSum / aSum);
        rawData[pxOffset + 1] = Math.round(gSum / aSum);
        rawData[pxOffset + 2] = Math.round(bSum / aSum);
        rawData[pxOffset + 3] = Math.round(avgAlpha * 255);
      } else {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdrData),
    createChunk('IDAT', deflated),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// Lightning bolt polygon in 128x128 SVG coordinate space (matches icon.svg)
const BOLT_POLY = [
  [68, 37],
  [47, 66],
  [61, 66],
  [57, 91],
  [82, 59],
  [68, 59],
  [73, 37]
];

function sampleIcon(u, v) {
  const x = u * 128;
  const y = v * 128;

  // Outer rounded square container (rx=28)
  if (!insideRoundedRect(x, y, 0, 0, 128, 128, 28)) {
    return [0, 0, 0, 0];
  }

  // Shopee diagonal gradient (#FF5A26 -> #EE4D2D)
  const t = Math.min(1, Math.max(0, (u + v) * 0.5));
  const bgR = Math.round(255 + (238 - 255) * t);
  const bgG = Math.round(92 + (77 - 92) * t);
  const bgB = Math.round(38 + (45 - 38) * t);

  // White voucher ticket with rounded corners and circular side notches
  const inTicketRect = insideRoundedRect(x, y, 22, 30, 106, 98, 9);
  const inLeftNotch = (x - 22) ** 2 + (y - 64) ** 2 < 10.5 ** 2;
  const inRightNotch = (x - 106) ** 2 + (y - 64) ** 2 < 10.5 ** 2;

  if (inTicketRect && !inLeftNotch && !inRightNotch) {
    if (pointInPolygon(x, y, BOLT_POLY)) {
      return [238, 77, 45, 255];
    }
    return [255, 255, 255, 255];
  }

  // Subtle drop shadow directly beneath ticket
  const inShadowRect = insideRoundedRect(x, y - 3, 22, 30, 106, 98, 9);
  const inShadowNotchL = (x - 22) ** 2 + (y - 67) ** 2 < 10.5 ** 2;
  const inShadowNotchR = (x - 106) ** 2 + (y - 67) ** 2 < 10.5 ** 2;
  if (inShadowRect && !inShadowNotchL && !inShadowNotchR) {
    return [Math.round(bgR * 0.85), Math.round(bgG * 0.85), Math.round(bgB * 0.85), 255];
  }

  return [bgR, bgG, bgB, 255];
}

[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size, size, sampleIcon);
  fs.writeFileSync(path.join(assetsDir, `icon${size}.png`), pngBuf);
  console.log(`Generated assets/icon${size}.png`);
});

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="shopeeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF5C26"/>
      <stop offset="100%" stop-color="#EE4D2D"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#shopeeGrad)"/>
  <g filter="url(#shadow)">
    <path d="M22 39C22 34.03 26.03 30 31 30H97C101.97 30 106 34.03 106 39V53.5C100.2 53.5 95.5 58.2 95.5 64C95.5 69.8 100.2 74.5 106 74.5V89C106 93.97 101.97 98 97 98H31C26.03 98 22 93.97 22 89V74.5C27.8 74.5 32.5 69.8 32.5 64C32.5 58.2 27.8 53.5 22 53.5V39Z" fill="#FFFFFF"/>
  </g>
  <path d="M68 37L47 66H61L57 91L82 59H68L73 37Z" fill="#EE4D2D"/>
</svg>
`;
fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svgContent);
console.log('Generated assets/icon.svg');

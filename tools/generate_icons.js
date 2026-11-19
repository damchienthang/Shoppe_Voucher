import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create assets directory
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Function to create a PNG file buffer with RGBA pixels
function createPng(width, height, getPixel) {
  const bytesPerPixel = 4;
  const scanlineLength = width * bytesPerPixel + 1; // +1 for filter type 0
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * bytesPerPixel;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // PNG Header & Chunks
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type 6 (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = createChunk('IDAT', deflated);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
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

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Drawing logic: Modern Shopee Orange Gradient + Voucher Icon + Lightning
function renderIcon(x, y, w, h) {
  const nx = (x + 0.5) / w;
  const ny = (y + 0.5) / h;
  const cx = 0.5;
  const cy = 0.5;
  const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);

  // Rounded rectangle bounds for icon container
  const cornerRadius = 0.22;
  const rx = Math.max(Math.abs(nx - 0.5) - (0.5 - cornerRadius), 0);
  const ry = Math.max(Math.abs(ny - 0.5) - (0.5 - cornerRadius), 0);
  const cornerDist = Math.sqrt(rx * rx + ry * ry);

  if (cornerDist > cornerRadius) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  // Background Gradient (Shopee Orange: #FF5722 to #EE4D2D to #FF3838)
  const grad = ny;
  let bgR = Math.round(255 - grad * 20);
  let bgG = Math.round(87 - grad * 35);
  let bgB = Math.round(34 + grad * 10);

  // Voucher Ticket Shape in center
  // Ticket box: x from 0.20 to 0.80, y from 0.26 to 0.74
  const insideTicket = nx >= 0.20 && nx <= 0.80 && ny >= 0.28 && ny <= 0.72;
  // Ticket side notches (circles at left and right edges)
  const notchL = Math.sqrt((nx - 0.20) ** 2 + (ny - 0.50) ** 2) < 0.08;
  const notchR = Math.sqrt((nx - 0.80) ** 2 + (ny - 0.50) ** 2) < 0.08;

  if (insideTicket && !notchL && !notchR) {
    // Ticket background: Pure White
    // Center lightning symbol or percent symbol
    const lx = nx - 0.50;
    const ly = ny - 0.50;

    // Check if inside lightning bolt
    // Segment 1: top right to mid
    const inTopBolt = (ly >= -0.15 && ly <= 0.02 && lx >= -0.08 - ly * 0.5 && lx <= 0.08 - ly * 0.4);
    // Segment 2: mid to bottom left
    const inBotBolt = (ly >= -0.02 && ly <= 0.15 && lx >= -0.08 - (ly - 0.05) * 0.6 && lx <= 0.06 - (ly - 0.05) * 0.4);

    if (inTopBolt || inBotBolt) {
      return [238, 77, 45, 255]; // Shopee red-orange bolt
    }

    return [255, 255, 255, 255]; // White ticket
  }

  return [bgR, bgG, bgB, 255];
}

// Generate 16, 48, 128
[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size, size, renderIcon);
  fs.writeFileSync(path.join(assetsDir, `icon${size}.png`), pngBuf);
  console.log(`Generated icon${size}.png`);
});

// Also create an SVG version
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="shopeeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF5722"/>
      <stop offset="100%" stop-color="#EE4D2D"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#shopeeGrad)"/>
  <g filter="url(#shadow)">
    <path d="M26 36C26 31.58 29.58 28 34 28H94C98.42 28 102 31.58 102 36V54C96.48 54 92 58.48 92 64C92 69.52 96.48 74 102 74V92C102 96.42 98.42 100 94 100H34C29.58 100 26 96.42 26 92V74C31.52 74 36 69.52 36 64C36 58.48 31.52 54 26 54V36Z" fill="#FFFFFF"/>
  </g>
  <path d="M68 38L48 66H62L58 90L82 60H68L74 38Z" fill="#EE4D2D"/>
</svg>`;
fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svgContent);
console.log('Generated icon.svg');

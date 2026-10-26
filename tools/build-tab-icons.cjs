// Small antialiased PNG line icons; no runtime image/font dependency.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const output = path.join(__dirname, '../images/tabs');
fs.mkdirSync(output, { recursive: true });
function crc32(bytes) { let crc = -1; for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function chunk(type, data) { const body = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(body)); return Buffer.concat([head, body, tail]); }
const palettes = [
  { suffix: '', active: false, color: [119,119,109] },
  { suffix: '-active', active: true, color: [82,102,49] },
  { suffix: '-active-pink', active: true, color: [159,72,101] },
  { suffix: '-active-gold', active: true, color: [133,98,22] },
  { suffix: '-active-sand', active: true, color: [117,100,72] }
];
for (const name of ['home', 'discover', 'records', 'profile']) for (const { active, color, suffix } of palettes) {
  const size = 81, scale = 3, width = size * scale, coverage = new Uint8Array(width * width);
  const dot = (x, y) => { const radius = active ? 2.3 : 1.8; for (let py = Math.max(0, Math.floor((y - radius) * scale)); py < Math.min(width, (y + radius) * scale); py++) for (let px = Math.max(0, Math.floor((x - radius) * scale)); px < Math.min(width, (x + radius) * scale); px++) if (Math.hypot(px / scale - x, py / scale - y) <= radius) coverage[py * width + px] = 1; };
  const line = (a, b) => { const n = Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) * 4); for (let i = 0; i <= n; i++) dot(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); };
  const poly = points => points.slice(1).forEach((p, i) => line(points[i], p));
  const arc = (x, y, rx, ry, start = 0, end = 2 * Math.PI) => { for (let t = start; t <= end; t += .01) dot(x + rx * Math.cos(t), y + ry * Math.sin(t)); };
  if (name === 'home') { poly([[15,37],[40,16],[66,37]]); poly([[22,33],[22,65],[34,65],[34,47],[47,47],[47,65],[59,65],[59,33]]); }
  if (name === 'discover') { arc(40.5,40.5,25,25); poly([[51,30],[44,44],[30,51],[36,36],[51,30]]); }
  if (name === 'records') { poly([[23,16],[60,16],[60,65],[23,65],[23,16]]); [25,40,55].forEach(y => line([16,y],[27,y])); poly([[34,40],[41,47],[51,33]]); }
  if (name === 'profile') { arc(40.5,26,11,11); arc(40.5,64,24,20,Math.PI,2*Math.PI); line([17,64],[64,64]); }
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let hits = 0; for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) hits += coverage[(y * scale + sy) * width + x * scale + sx];
    const off = y * (1 + size * 4) + 1 + x * 4; raw.set([...color, Math.round(hits / 9 * 255)], off);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  fs.writeFileSync(path.join(output, name + suffix + '.png'), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

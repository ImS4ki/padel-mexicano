// Builds the app from app.html into:
//   android/app/src/main/assets/index.html  (Android app wrapper)
//   web/                                    (installable offline web app: upload this folder to any static host)
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const root = __dirname;
const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const cut = src.indexOf('</style>') + '</style>'.length;

function page(extraHead, extraBody) {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<style>body{margin:0}[hidden]{display:none!important}</style>\n' + extraHead +
    src.slice(0, cut) + '\n</head><body>\n' + src.slice(cut) + '\n' + extraBody + '</body></html>\n';
}
function write(rel, data) {
  const out = path.join(root, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
  console.log('Wrote ' + rel + ' (' + data.length + ' bytes)');
}

// Android
write('android/app/src/main/assets/index.html', page('', ''));

// Web app
const html = page(
  '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" type="image/png" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-192.png">\n',
  "<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}</script>\n");
write('web/index.html', html);

write('web/manifest.webmanifest', JSON.stringify({
  name: 'Padel Mexicano', short_name: 'Mexicano', description: 'Mexicano padel matches, pairs and standings',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#1D4E9E', theme_color: '#1D4E9E',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));

// Service worker: cache name changes whenever the page changes, so phones pick up new versions.
const version = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);
write('web/sw.js', `const CACHE = 'padel-mexicano-${version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const put = (req, res) => { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); return res; };
  if (url.origin === location.origin) {
    // Network first so updates arrive; cached copy when offline.
    e.respondWith(fetch(e.request).then(r => put(e.request, r))
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (/fonts\\.(googleapis|gstatic)\\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => put(e.request, res))));
  }
});
`);

// Icons: padel ball on court blue, drawn with 4x4 supersampling, encoded as PNG.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const blue = [0x1d, 0x4e, 0x9e], ball = [0xdc, 0xeb, 0x4b];
  const cx = size / 2, cy = size / 2, r = size * 0.3, seamOff = r * 1.33, seamW = size * 0.022;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        const d = Math.hypot(px - cx, py - cy);
        if (d > r) continue;
        const dl = Math.abs(Math.hypot(px - (cx - seamOff), py - cy) - r);
        const dr = Math.abs(Math.hypot(px - (cx + seamOff), py - cy) - r);
        if (dl < seamW || dr < seamW) continue;
        cov++;
      }
      const a = cov / (SS * SS), o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(blue[i] * (1 - a) + ball[i] * a);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
write('web/icon-192.png', icon(192));
write('web/icon-512.png', icon(512));

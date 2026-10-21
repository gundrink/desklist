import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}

function dist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Dark rounded tile with a bronze check, drawn as an RGBA PNG. */
function iconPng(size: number) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const stroke = Math.max(1.4, size * 0.09);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const cx = Math.max(radius, Math.min(px, size - radius));
      const cy = Math.max(radius, Math.min(py, size - radius));
      const inside = (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius;
      const i = (y * size + x) * 4;
      if (!inside) continue;
      const onCheck = dist(px, py, size * 0.28, size * 0.52, size * 0.44, size * 0.68) <= stroke
        || dist(px, py, size * 0.44, size * 0.68, size * 0.74, size * 0.34) <= stroke;
      rgba[i] = onCheck ? 204 : 28;
      rgba[i + 1] = onCheck ? 188 : 27;
      rgba[i + 2] = onCheck ? 163 : 26;
      rgba[i + 3] = 255;
    }
  }
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function packExtension(): Plugin {
  return {
    name: 'desklist-extension',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: fs.readFileSync(path.join(root, 'manifest.json')) });
      for (const size of [16, 32, 48, 128]) {
        this.emitFile({ type: 'asset', fileName: `icons/${size}.png`, source: iconPng(size) });
      }
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  server: { fs: { allow: [path.resolve(root, '..')] } },
  plugins: [react(), packExtension()],
  resolve: { alias: { '@desklist/shared': path.join(root, '../shared/src/index.ts') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        panel: path.join(root, 'panel.html'),
        background: path.join(root, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

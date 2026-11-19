import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
const sizes = [16, 32, 48, 64, 96, 128, 256, 512];
const desktopFiles = [
  '32x32.png',
  '64x64.png',
  '128x128.png',
  '128x128@2x.png',
  'icon.png',
  'icon.icns',
  'icon.ico',
  'Square30x30Logo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
  'Square89x89Logo.png',
  'Square107x107Logo.png',
  'Square142x142Logo.png',
  'Square150x150Logo.png',
  'Square284x284Logo.png',
  'Square310x310Logo.png',
  'StoreLogo.png',
];

export function parseArgs(args) {
  if (args.length === 0) return join(root, 'assets/brand/generated');
  if (args.length === 2 && args[0] === '--output' && args[1] && !args[1].startsWith('--'))
    return resolve(args[1]);
  throw new Error('Usage: node scripts/generate-brand-icons.mjs [--output <path>]');
}

// Snap every vertex, including the counters, to the destination pixel grid.
export function snappedPath(path, size) {
  const width = size * 0.75;
  const height = (width * 25) / 36;
  const left = (size - width) / 2;
  const top = (size - height) / 2;
  return path.replace(/([MHV])\s*([\d.]+)(?:\s+([\d.]+))?/g, (_, command, a, b) => {
    if (command === 'M')
      return `M${Math.round(left + (Number(a) * width) / 36)} ${Math.round(top + (Number(b) * height) / 25)}`;
    if (command === 'H') return `H${Math.round(left + (Number(a) * width) / 36)}`;
    return `V${Math.round(top + (Number(a) * height) / 25)}`;
  });
}

export function ringSvg(path, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path fill="#ff4e4d" fill-rule="evenodd" d="${snappedPath(path, size)}"/></svg>\n`;
}

// Tauri emits the same ICNS chunks in nondeterministic order. Preserve each
// chunk verbatim and keep legacy color/mask pairs adjacent.
function normalizeIcns(icon) {
  if (
    icon.length < 8 ||
    icon.toString('ascii', 0, 4) !== 'icns' ||
    icon.readUInt32BE(4) !== icon.length
  )
    throw new Error('Invalid ICNS header');
  const chunks = [];
  for (let offset = 8; offset < icon.length; ) {
    if (offset + 8 > icon.length) throw new Error('Invalid ICNS chunk header');
    const length = icon.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > icon.length) throw new Error('Invalid ICNS chunk length');
    chunks.push(icon.subarray(offset, offset + length));
    offset += length;
  }
  const order = [
    'ic07',
    'ic08',
    'ic09',
    'ic10',
    'ic11',
    'ic12',
    'ic13',
    'ic14',
    'is32',
    's8mk',
    'il32',
    'l8mk',
  ];
  chunks.sort((a, b) => {
    const key = (chunk) => {
      const type = chunk.toString('ascii', 0, 4);
      const index = order.indexOf(type);
      return index < 0 ? `z${type}` : `a${String(index).padStart(2, '0')}`;
    };
    const aKey = key(a),
      bKey = key(b);
    return (aKey < bKey ? -1 : aKey > bKey ? 1 : 0) || Buffer.compare(a, b);
  });
  return Buffer.concat([icon.subarray(0, 8), ...chunks]);
}

function raster(svg, size, scratch, name) {
  const input = join(scratch, `${name}.svg`);
  const output = join(scratch, name);
  writeFileSync(input, svg);
  execFileSync(process.execPath, [cli, 'icon', input, '--output', output, '--png', String(size)], {
    cwd: root,
    stdio: 'pipe',
  });
  return join(output, `${size}x${size}.png`);
}

function reviewHtml() {
  const rows = sizes
    .map((size) => {
      const extension = size <= 128 ? `extensions/icon-${size}.png` : `preview/ring-${size}.png`;
      return `<tr><th>${size} px</th>${['#f6f2eb', '#2f384b'].map((bg) => `<td style="background:${bg}"><img src="preview/desktop-${size}.png" width="${size}" height="${size}" alt="Desktop ${size}"></td><td style="background:${bg}"><img src="${extension}" width="${size}" height="${size}" alt="Ring ${size}"></td>`).join('')}</tr>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Grace icon review</title><style>body{font:15px system-ui;margin:2rem;color:#17202d}table{border-collapse:collapse}th,td{border:1px solid #aaa;padding:12px;text-align:center}td{vertical-align:middle}img{display:block;margin:auto}</style><h1>Grace icon review</h1><p>Images are displayed at their actual pixel dimensions.</p><table><thead><tr><th>Size</th><th colspan="2">Light: desktop / ring</th><th colspan="2">Dark: desktop / ring</th></tr></thead><tbody>${rows}</tbody></table></html>\n`;
}

export function generate(output) {
  const source = readFileSync(join(root, 'assets/brand/grace-mark.svg'), 'utf8');
  const path = source.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1];
  if (!path) throw new Error('Master SVG must contain a path with a d attribute');
  const scratch = mkdtempSync(join(tmpdir(), 'grace-icons-'));
  try {
    const desktopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="64" y="64" width="896" height="896" rx="192" fill="#2f384b"/><path fill="#ff4e4d" fill-rule="evenodd" transform="translate(152 262) scale(20)" d="${path}"/></svg>\n`;
    const desktop = join(output, 'desktop');
    const extensions = join(output, 'extensions');
    const preview = join(output, 'preview');
    for (const directory of [desktop, extensions, preview])
      mkdirSync(directory, { recursive: true });
    writeFileSync(join(output, 'desktop.svg'), desktopSvg);
    const native = join(scratch, 'native');
    execFileSync(process.execPath, [cli, 'icon', join(output, 'desktop.svg'), '--output', native], {
      cwd: root,
      stdio: 'pipe',
    });
    for (const name of desktopFiles) {
      if (name === '64x64.png') continue;
      if (name === 'icon.icns') {
        writeFileSync(join(desktop, name), normalizeIcns(readFileSync(join(native, name))));
      } else {
        copyFileSync(join(native, name), join(desktop, name));
      }
    }
    for (const size of sizes) {
      const tile = raster(desktopSvg, size, scratch, `desktop-${size}`);
      copyFileSync(tile, join(preview, `desktop-${size}.png`));
      if (size === 64) copyFileSync(tile, join(desktop, '64x64.png'));
      const ring = raster(ringSvg(path, size), size, scratch, `ring-${size}`);
      copyFileSync(
        ring,
        join(
          size <= 128 ? extensions : preview,
          size <= 128 ? `icon-${size}.png` : `ring-${size}.png`
        )
      );
    }
    writeFileSync(join(output, 'review.html'), reviewHtml());
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    generate(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

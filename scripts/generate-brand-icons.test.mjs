import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { generate, parseArgs, snappedPath } from './generate-brand-icons.mjs';

function decodePng(file) {
  const png = readFileSync(file);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  assert.equal(png[24], 8); // 8-bit RGBA
  assert.equal(png[25], 6);
  assert.equal(png[28], 0); // no interlacing
  const chunks = [];
  for (let pos = 8; pos < png.length; ) {
    const length = png.readUInt32BE(pos);
    if (png.toString('ascii', pos + 4, pos + 8) === 'IDAT')
      chunks.push(png.subarray(pos + 8, pos + 8 + length));
    pos += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x,
        a = x >= 4 ? pixels[index - 4] : 0;
      const b = y ? pixels[index - stride] : 0,
        c = y && x >= 4 ? pixels[index - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else assert.equal(filter, 0);
      pixels[index] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

test('argument parsing rejects unknown and incomplete options', () => {
  assert.throws(() => parseArgs(['--bad']));
  assert.throws(() => parseArgs(['--output']));
  assert.throws(() => parseArgs(['--output', 'a', 'extra']));
  assert.match(parseArgs(['--output', 'icons']), /icons$/);
});

test('small mark vertices snap to whole pixels', () => {
  const path = snappedPath(
    'M6 0H30V5H33V10H36V15H33V20H30V25H6V20H3V15H0V10H3V5H6Z M12 5H24V10H27V15H24V20H12V15H9V10H12Z M15 9.5H21V15.5H15Z',
    16
  );
  assert.equal(
    path,
    'M4 4H12V6H13V7H14V9H13V11H12V12H4V11H3V9H2V7H3V6H4Z M6 6H10V7H11V9H10V11H6V9H5V7H6Z M7 7H9V9H7Z'
  );
});

test('staged PNGs have the expected size, centered square and open gap', () => {
  const output = mkdtempSync(join(tmpdir(), 'grace icon test-'));
  try {
    generate(output);
    for (const size of [16, 32, 48, 64, 96, 128]) {
      const { width, height, pixels } = decodePng(join(output, 'extensions', `icon-${size}.png`));
      assert.equal(width, size);
      assert.equal(height, size);
      const alpha = (x, y) => pixels[(y * size + x) * 4 + 3];
      assert.equal(alpha(0, 0), 0);
      const center = ((size / 2) * size + size / 2) * 4;
      assert.deepEqual([...pixels.subarray(center, center + 4)], [255, 78, 77, 255]);
      assert.equal(alpha(Math.floor(size * 0.375), size / 2), 0);
      assert.equal(alpha(Math.ceil(size * 0.625), size / 2), 0);
      const dotStart = size / 2 - size / 16;
      const dotEnd = size / 2 + size / 16;
      for (let i = dotStart; i < dotEnd; i++) {
        assert.equal(alpha(i, size / 2), 255);
        assert.equal(alpha(size / 2, i), 255);
      }
      assert.equal(alpha(dotStart - 1, size / 2), 0);
      assert.equal(alpha(dotEnd, size / 2), 0);
      assert.equal(alpha(size / 2, dotStart - 1), 0);
      assert.equal(alpha(size / 2, dotEnd), 0);
      assert.equal(alpha(size / 2, Math.round(size * 0.3)), 255);
      if (size <= 32) {
        for (let i = 3; i < pixels.length; i += 4) assert.ok(pixels[i] === 0 || pixels[i] === 255);
      }
    }
    assert.equal(decodePng(join(output, 'desktop', 'icon.png')).width, 512);
    assert.match(readFileSync(join(output, 'review.html'), 'utf8'), /preview\/desktop-512\.png/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('all staged files are byte-identical across generations and ICNS chunks are valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'grace reproducibility test-'));
  try {
    const first = join(root, 'first'),
      second = join(root, 'second');
    generate(first);
    generate(second);
    function files(dir, prefix = '') {
      return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(dir, join(prefix, entry.name)) : [join(prefix, entry.name)]
      );
    }
    const names = files(first).sort();
    assert.deepEqual(names, files(second).sort());
    for (const name of names) {
      assert.ok(
        readFileSync(join(first, name)).equals(readFileSync(join(second, name))),
        `${name} differs`
      );
    }
    const icon = readFileSync(join(first, 'desktop/icon.icns'));
    assert.equal(icon.toString('ascii', 0, 4), 'icns');
    assert.equal(icon.readUInt32BE(4), icon.length);
    const types = [];
    let offset = 8;
    while (offset < icon.length) {
      assert.ok(offset + 8 <= icon.length);
      const length = icon.readUInt32BE(offset + 4);
      assert.ok(length >= 8 && offset + length <= icon.length);
      types.push(icon.toString('ascii', offset, offset + 4));
      offset += length;
    }
    assert.equal(offset, icon.length);
    assert.deepEqual(
      types.slice().sort(),
      [
        'ic07',
        'ic08',
        'ic09',
        'ic10',
        'ic11',
        'ic12',
        'ic13',
        'ic14',
        'il32',
        'is32',
        'l8mk',
        's8mk',
      ].sort()
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

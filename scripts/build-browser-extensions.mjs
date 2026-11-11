import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { verifySignedGeckoArtifact } from './gecko-signed-artifact.mjs';
import { assertSafeExtensionTree } from './extension-source-guard.mjs';

const rootDir = process.cwd();
const sharedDir = path.join(rootDir, 'extensions', 'focus');
const distDir = path.join(rootDir, 'extensions', 'dist');
const browsers = ['chrome', 'firefox', 'safari'];
assertSafeExtensionTree(sharedDir);
for (const browser of browsers) {
  const browserSourceDir = path.join(rootDir, 'extensions', browser);
  if (fs.existsSync(browserSourceDir)) assertSafeExtensionTree(browserSourceDir);
}

const args = process.argv.slice(2);
if (args.some(arg => !['--require-signed', '--development'].includes(arg))) throw new Error('Unknown extension build option');
const development = args.includes('--development');
if (development && args.includes('--require-signed')) throw new Error('--development and --require-signed are mutually exclusive');
const signedDir = path.join(rootDir, 'extensions', 'signed', 'firefox');
const artifactPath = path.join(signedDir, 'focus@pomotroid.local.xpi');
const provenancePath = path.join(signedDir, 'provenance.json');
const hasArtifact = fs.existsSync(artifactPath);
const hasProvenance = fs.existsSync(provenancePath);
if (!development && (hasArtifact !== hasProvenance || (!hasArtifact && args.includes('--require-signed')))) {
  throw new Error('Signed Gecko artifact required with provenance');
}
const signedBytes = !development && hasArtifact ? verifySignedGeckoArtifact({
  artifactPath, provenancePath, sharedDir,
  manifestPath: path.join(rootDir, 'extensions', 'firefox', 'manifest.json')
}) : null;
if (!signedBytes) console.log('Unsigned Gecko development package; not persistent-installation evidence' + (development ? ' (--development: signed artifact ignored)' : ''));

function createZipFromDirectory(sourceDir, targetZipPath) {
  function getFiles(dir, base = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getFiles(fullPath, relPath));
      } else if (entry.isFile()) {
        if (!entry.name.endsWith('.xpi') && !entry.name.endsWith('.zip')) {
          files.push({ relPath: relPath.replace(/\\/g, '/'), fullPath });
        }
      }
    }
    return files;
  }

  const files = getFiles(sourceDir);
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.fullPath);
    const nameBuffer = Buffer.from(file.relPath, 'utf8');
    const crc = zlib.crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const compressedSize = compressed.length;
    const uncompressedSize = data.length;

    // Local Header (30 + name.length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // Deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    const localChunk = Buffer.concat([localHeader, compressed]);
    localHeaders.push(localChunk);

    // Central Header (46 + name.length)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localChunk.length;
  }

  const centralDir = Buffer.concat(centralHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const zipBuffer = Buffer.concat([...localHeaders, centralDir, eocd]);
  fs.writeFileSync(targetZipPath, zipBuffer);
}

for (const browser of browsers) {
  const browserDist = path.join(distDir, browser);
  fs.rmSync(browserDist, { recursive: true, force: true });
  fs.mkdirSync(browserDist, { recursive: true });

  // Copy shared files
  for (const file of fs.readdirSync(sharedDir)) {
    fs.copyFileSync(path.join(sharedDir, file), path.join(browserDist, file));
  }

  // Copy browser manifest
  const manifestPath = path.join(rootDir, 'extensions', browser, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    fs.copyFileSync(manifestPath, path.join(browserDist, 'manifest.json'));
  }

  if (browser === 'firefox') {
    const xpiPath = path.join(browserDist, 'focus@pomotroid.local.xpi');
    if (signedBytes) fs.writeFileSync(xpiPath, signedBytes);
    else createZipFromDirectory(browserDist, xpiPath);
  } else if (browser === 'chrome') {
    const zipPath = path.join(distDir, 'chrome.zip');
    createZipFromDirectory(browserDist, zipPath);
  }
}

console.log('Extensions built in extensions/dist/{chrome,firefox,safari}');

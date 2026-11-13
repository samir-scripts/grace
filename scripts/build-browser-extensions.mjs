import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { geckoPayload } from './gecko-payload.mjs';
import { verifySignedGeckoArtifact } from './gecko-signed-artifact.mjs';
import { readChromeReleaseConfig } from './chrome-release-config.mjs';
import { assertSafeExtensionTree } from './extension-source-guard.mjs';

const rootDir = process.cwd();
const sharedDir = path.join(rootDir, 'extensions', 'focus');
const distDir = path.join(rootDir, 'extensions', 'dist');
const args = process.argv.slice(2);
const chromeOnly = args.includes('--chrome-release') || args.includes('--chrome-draft');
const browsers = chromeOnly ? ['chrome'] : ['chrome', 'firefox', 'safari'];
assertSafeExtensionTree(sharedDir);
for (const browser of browsers) {
  const browserSourceDir = path.join(rootDir, 'extensions', browser);
  if (fs.existsSync(browserSourceDir)) assertSafeExtensionTree(browserSourceDir);
}

if (args.some(arg => !['--require-signed', '--development', '--chrome-release', '--chrome-draft'].includes(arg))) throw new Error('Unknown extension build option');
const development = args.includes('--development');
if (development && args.includes('--require-signed')) throw new Error('--development and --require-signed are mutually exclusive');
if (args.includes('--chrome-release') && args.includes('--chrome-draft') || chromeOnly && (development || args.includes('--require-signed'))) throw new Error('Chrome-only and other build modes are mutually exclusive');
const signedDir = path.join(rootDir, 'extensions', 'signed', 'firefox');
const artifactPath = path.join(signedDir, 'focus@pomotroid.local.xpi');
const provenancePath = path.join(signedDir, 'provenance.json');
const hasArtifact = fs.existsSync(artifactPath);
const hasProvenance = fs.existsSync(provenancePath);
if (!chromeOnly && !development && (hasArtifact !== hasProvenance || (!hasArtifact && args.includes('--require-signed')))) {
  throw new Error('Signed Gecko artifact required with provenance');
}
const signedBytes = !chromeOnly && !development && hasArtifact ? verifySignedGeckoArtifact({
  artifactPath, provenancePath, sharedDir,
  manifestPath: path.join(rootDir, 'extensions', 'firefox', 'manifest.json')
}) : null;
if (!chromeOnly && !signedBytes) console.log('Unsigned Gecko development package; not persistent-installation evidence' + (development ? ' (--development: signed artifact ignored)' : ''));

const chromeSource = path.join(rootDir, 'extensions/chrome');
const chromeManifest = JSON.parse(fs.readFileSync(path.join(chromeSource, 'manifest.json'), 'utf8'));
if (args.includes('--chrome-draft')) delete chromeManifest.key;
else if (!development) {
  const config = readChromeReleaseConfig(path.join(chromeSource, 'release.json'), chromeManifest.key);
  chromeManifest.key = config.public_key;
}
// Validate before touching any previous output.
for (const size of [16, 32, 48, 128]) {
  const icon = fs.readFileSync(path.join(chromeSource, chromeManifest.icons?.[size] ?? 'missing-icon'));
  if (icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || icon.readUInt32BE(16) !== size || icon.readUInt32BE(20) !== size) throw new Error('Invalid Chrome icon dimensions');
}
if (chromeManifest.manifest_version !== 3 || chromeManifest.minimum_chrome_version !== '116' || !chromeManifest.options_ui?.page || !chromeManifest.background?.service_worker) throw new Error('Invalid Chrome manifest');

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
  const browserDist = path.join(distDir, args.includes('--chrome-draft') ? 'chrome-draft' : browser);
  fs.rmSync(browserDist, { recursive: true, force: true });
  fs.mkdirSync(browserDist, { recursive: true });

  // Copy shared files
  if (browser === 'firefox') {
    for (const [name, bytes] of geckoPayload(sharedDir, path.join(rootDir, 'extensions/firefox/manifest.json'))) {
      const target = path.join(browserDist, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
  } else {
    for (const file of fs.readdirSync(sharedDir)) {
      fs.copyFileSync(path.join(sharedDir, file), path.join(browserDist, file));
    }
  }

  // Copy browser manifest
  const manifestPath = path.join(rootDir, 'extensions', browser, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    if (browser === 'chrome') {
      fs.writeFileSync(path.join(browserDist, 'manifest.json'), JSON.stringify(chromeManifest, null, 2) + '\n');
      fs.cpSync(path.join(chromeSource, 'icons'), path.join(browserDist, 'icons'), { recursive: true });
      fs.copyFileSync(path.join(chromeSource, 'chrome-background.js'), path.join(browserDist, 'chrome-background.js'));
      for (const name of ['chrome-options.js', 'chrome-diagnostics.js']) fs.copyFileSync(path.join(chromeSource, name), path.join(browserDist, name));
      const options = fs.readFileSync(path.join(browserDist, 'options.html'), 'utf8');
      fs.writeFileSync(path.join(browserDist, 'options.html'), options.replace('<footer>', '<footer><a class="text-button" href="https://grace-focus.github.io/" target="_blank" rel="noopener noreferrer">Website</a> <a class="text-button" href="https://grace-focus.github.io/privacy/" target="_blank" rel="noopener noreferrer">Privacy</a> ').replace('</body>', '<script type="module" src="chrome-options.js"></script>\n</body>'));
    } else fs.copyFileSync(manifestPath, path.join(browserDist, 'manifest.json'));
  }

  if (browser === 'firefox') {
    const xpiPath = path.join(browserDist, 'focus@pomotroid.local.xpi');
    if (signedBytes) fs.writeFileSync(xpiPath, signedBytes);
    else createZipFromDirectory(browserDist, xpiPath);
  } else if (browser === 'chrome') {
    const zipPath = path.join(distDir, args.includes('--chrome-draft') ? 'chrome-draft.zip' : 'chrome.zip');
    createZipFromDirectory(browserDist, zipPath);
  }
}

console.log(chromeOnly ? `Chrome ${args.includes('--chrome-draft') ? 'identity bootstrap draft' : 'release'} built in extensions/dist` : 'Extensions built in extensions/dist/{chrome,firefox,safari}');

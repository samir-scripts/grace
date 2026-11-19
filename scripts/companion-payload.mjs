import fs from 'node:fs';
import path from 'node:path';
import { assertSafeExtensionTree } from './extension-source-guard.mjs';

const names = ['blocked.html', 'options.html', 'options.css', ...[16, 32, 48, 64, 96, 128].map(size => `icon-${size}.png`)];

export function applyCompanionOverlay(files, sharedDir) {
  const overlay = path.join(path.dirname(sharedDir), 'companion');
  if (!fs.lstatSync(overlay, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Unexpected companion payload override');
  assertSafeExtensionTree(overlay);
  const entries = fs.readdirSync(overlay, { withFileTypes: true });
  if (entries.length !== names.length || entries.some(entry => !entry.isFile() || !names.includes(entry.name))) throw new Error('Unexpected companion payload override');
  for (const name of names) files.set(name, fs.readFileSync(path.join(overlay, name)));
  return files;
}

export function validateCompanionIcons(files, ...groups) {
  for (const group of groups) for (const [size, name] of Object.entries(group ?? {})) {
    const icon = files.get(name);
    if (!icon || icon.length < 24 || icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || icon.readUInt32BE(16) !== Number(size) || icon.readUInt32BE(20) !== Number(size)) throw new Error('Invalid companion icon dimensions');
  }
}
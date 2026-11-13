import fs from 'node:fs';
import path from 'node:path';
import { assertSafeExtensionTree } from './extension-source-guard.mjs';

// One expected payload for unsigned builds, signing input, and signed verification.
export function geckoPayload(sharedDir, manifestPath) {
  assertSafeExtensionTree(sharedDir);
  const files = new Map();
  function collect(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) collect(path.join(dir, entry.name), name + '/');
      else if (entry.isFile()) files.set(name, fs.readFileSync(path.join(dir, entry.name)));
      else throw new Error('Unsupported source entry in Gecko companion');
    }
  }
  collect(sharedDir);
  const overlay = path.join(path.dirname(manifestPath), 'payload');
  if (fs.existsSync(overlay)) {
    assertSafeExtensionTree(overlay);
    const names = fs.readdirSync(overlay, { withFileTypes: true });
    if (names.length !== 1 || names[0].name !== 'options.html' || !names[0].isFile() || !files.has('options.html')) throw new Error('Unexpected Firefox payload override');
    files.set('options.html', fs.readFileSync(path.join(overlay, 'options.html')));
  }
  return files;
}

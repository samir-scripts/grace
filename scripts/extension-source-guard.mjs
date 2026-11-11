import fs from 'node:fs';
import path from 'node:path';

// Reject likely credential files by name without inspecting or printing their contents.
export function assertSafeExtensionName(name) {
  const parts = name.split(/[\\/]/).map(part => part.toLowerCase());
  if (parts.some(base => base === '.env' || base.startsWith('.env.') || /\.(?:pem|key|p12|pfx)$/.test(base))) {
    throw new Error('Credential file is not allowed in extension source or package');
  }
}

export function assertSafeExtensionTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assertSafeExtensionName(entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) assertSafeExtensionTree(full);
    else if (!entry.isFile()) throw new Error('Unsupported entry in extension source');
  }
}

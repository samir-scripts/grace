import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const storeId = 'cgibenlmgmblmalggjalnoaikjkdnoid';

test('Chrome development origin matches the existing Web Store item', () => {
  const manifest = JSON.parse(readFileSync(new URL('../chrome/manifest.json', import.meta.url), 'utf8'));
  const publicKey = Buffer.from(manifest.key, 'base64');
  assert.equal(createPublicKey({ key: publicKey, format: 'der', type: 'spki' }).asymmetricKeyType, 'rsa');
  const extensionId = createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  assert.equal(extensionId, storeId);
});

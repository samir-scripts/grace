import fs from 'node:fs';
import path from 'node:path';

export function generateChromePolicy(extensionId, updateUrl) {
  if (!extensionId || typeof extensionId !== 'string' || !/^[a-z]{32}$/.test(extensionId)) {
    throw new Error('Chrome extension ID must be a 32-character lowercase string (a-z).');
  }
  if (!updateUrl || typeof updateUrl !== 'string') {
    throw new Error('Chrome update_url is required.');
  }

  return {
    ExtensionSettings: {
      [extensionId]: {
        installation_mode: 'force_installed',
        update_url: updateUrl
      }
    }
  };
}

export function generateFirefoxPolicy(extensionId, installUrl) {
  if (!extensionId || typeof extensionId !== 'string') {
    throw new Error('Firefox extension ID is required (e.g. focus@pomotroid.local).');
  }

  const settings = {
    installation_mode: 'force_installed'
  };
  if (installUrl) {
    settings.install_url = installUrl;
  }

  return {
    policies: {
      ExtensionSettings: {
        [extensionId]: settings
      }
    }
  };
}

if (process.argv[1] && process.argv[1].endsWith('build-browser-policies.mjs')) {
  const distDir = path.join(process.cwd(), 'extensions', 'dist', 'policies');
  fs.mkdirSync(distDir, { recursive: true });

  const chromeTemplate = generateChromePolicy('abcdefghijklmnopqrstuvwxyzabcdef', 'https://clients2.google.com/service/update2/crx');
  fs.writeFileSync(path.join(distDir, 'chrome-extension-policy.json'), JSON.stringify(chromeTemplate, null, 2) + '\n');

  const firefoxTemplate = generateFirefoxPolicy('focus@pomotroid.local', 'file:///opt/pomotroid/extensions/firefox.xpi');
  fs.writeFileSync(path.join(distDir, 'firefox-policies.json'), JSON.stringify(firefoxTemplate, null, 2) + '\n');

  console.log('Sample enterprise browser policy templates generated in extensions/dist/policies/');
}

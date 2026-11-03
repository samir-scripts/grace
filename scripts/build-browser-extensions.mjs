import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const sharedDir = path.join(rootDir, 'extensions', 'focus');
const distDir = path.join(rootDir, 'extensions', 'dist');

const browsers = ['chrome', 'firefox'];

for (const browser of browsers) {
  const browserDist = path.join(distDir, browser);
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
}

console.log('Extensions built in extensions/dist/{chrome,firefox}');

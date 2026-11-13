import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildUniversal({ run, cwd, updater = false }) {
  const target = resolve(cwd, process.env.CARGO_TARGET_DIR || 'src-tauri/target');
  const release = join(target, 'universal-apple-darwin', 'release');
  const config = updater ? ['--config', '{"bundle":{"createUpdaterArtifacts":true}}'] : [];
  const execute = (command, args) => {
    const result = run(command, args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  };

  execute('npm', ['run', 'tauri', '--', 'build', '--no-bundle', '--target', 'universal-apple-darwin', ...config]);
  const hosts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((arch) =>
    join(target, arch, 'release', 'pomotroid-native-host'),
  );
  for (const host of hosts) {
    if (!existsSync(host)) throw new Error(`Native host missing: ${host}`);
  }
  mkdirSync(release, { recursive: true });
  execute('lipo', ['-create', ...hosts, '-output', join(release, 'pomotroid-native-host')]);
  for (const binary of ['pomotroid', 'pomotroid-native-host']) {
    execute('lipo', ['-verify_arch', 'arm64', 'x86_64', join(release, binary)]);
  }
  execute('npm', ['run', 'tauri', '--', 'bundle', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg', ...config]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    buildUniversal({ run: spawnSync, cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'), updater: process.argv.includes('--updater') });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

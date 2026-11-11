#!/usr/bin/env python3
"""Host-side ownership, source export and Tart lifecycle for focus acceptance."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
RUNS = ROOT / '.superpowers/sdd/tart-focus-acceptance'


def exportable(name):
    p = pathlib.PurePosixPath(name)
    if not p.parts or p.is_absolute() or '..' in p.parts:
        return False
    if any(part in {'.git', 'node_modules', 'target', '.superpowers', '.svelte-kit', '__pycache__'} or part.lower().startswith('.env') for part in p.parts):
        return False
    if any(re.search(r'(secret|token|password|credential|cookie|private|id_rsa)', part, re.I) for part in p.parts):
        return False
    allowed = {'.rs', '.svelte', '.ts', '.js', '.mjs', '.py', '.sh', '.json', '.toml', '.lock', '.html', '.css', '.md', '.xml', '.png', '.ico', '.icns', '.woff2', '.mp3', '.xpi', '.yaml', '.yml', '.txt'}
    return p.suffix.lower() in allowed and (p.parts[0] in {'src', 'src-tauri', 'static', 'extensions', 'scripts', 'tests', 'plans', 'project.inlang'} or name in {'package.json', 'package-lock.json', 'vite.config.js', 'svelte.config.js', 'tsconfig.json'})


def collectable(name):
    return name in {'provision.json', 'chrome-provision.json'} or bool(re.fullmatch(r'(?:scenario-(?:isolated|matching)-(?:baseline|work|break|released)|browser-(?:baseline|work|released)-(?:isolated|matching))-[A-Za-z0-9_.-]+[.]json', name))


def sanitize_report(value):
    if isinstance(value, dict):
        return {k: sanitize_report(v) for k, v in value.items() if not re.search(r'token|password|passphrase|credential|cookie|secret|authorization|api[_-]?key', k, re.I)}
    if isinstance(value, list):
        return [sanitize_report(v) for v in value]
    return value


def sanitize_native(value):
    return ''.join(line + '\n' for line in value.splitlines()
                   if re.match(r'^AX[A-Za-z]+ \| ', line)
                   and not line.startswith(('AXTextField', 'AXSecureTextField'))
                   and not re.search(r'profile-|password|passphrase|token|credential', line, re.I))


def should_transfer(resume, skip_download):
    return not (resume or skip_download)


def provision_flags(resume, skip_download):
    return (['--resume'] if resume else []) + (['--skip-download'] if skip_download else [])


def validate_app_links(app):
    root = app.resolve()
    for directory, dirs, files in os.walk(app, followlinks=False):
        for name in dirs + files:
            path = pathlib.Path(directory) / name
            if path.is_symlink():
                target = pathlib.Path(os.readlink(path))
                if target.is_absolute() or not path.resolve().is_relative_to(root):
                    raise ValueError(f'app bundle contains external symlink: {path}')


def validate_owner(data):
    run_id = data.get('run_id')
    if str(uuid.UUID(run_id)) != run_id or data.get('vm_name') != 'grace-acceptance-' + run_id:
        raise ValueError('run manifest is not an owned acceptance clone')
    return data


def initial_results(browser='zen'):
    if browser == 'chrome':
        from chrome import initial_results as chrome_results
        return chrome_results()
    return [{'id': name, 'status': 'blocked', 'reason': 'Native acceptance has not been observed.'}
            for name in ('profile-ui-persistence', 'signed-companion', 'existing-tabs', 'fresh-http', 'fresh-https',
                         'allowed-control', 'discord-baseline', 'discord-existing', 'discord-relaunch',
                         'unselected-app', 'break-restoration', 'natural-completion', 'restart',
                         'disconnect-retry', 'protected-quit', 'emergency-release')]


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def call(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, timeout=kwargs.pop('timeout', 120), **kwargs)


def git(*args):
    return call(['git', '-C', ROOT, *args], capture_output=True).stdout


def snapshot(directory, config, app):
    names = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')
    hashes = {}
    with tarfile.open(directory / 'source.tar.gz', 'w:gz') as archive:
        for name in sorted(set(names)):
            path = ROOT / name
            if name and exportable(name) and path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(ROOT.resolve()):
                hashes[name] = digest(path)
                archive.add(path, arcname='source/' + name, recursive=False)
        archive.add(config, arcname='config.json')
        if app:
            if app.suffix != '.app' or not app.is_dir():
                raise ValueError('--app must identify a built .app bundle')
            validate_app_links(app)
            archive.add(app, arcname='Grace.app')
    patch = git('diff', 'HEAD', '--binary')
    return {'head': git('rev-parse', 'HEAD').decode().strip(),
            'dirty_patch_sha256': hashlib.sha256(patch).hexdigest(),
            'files': hashes, 'archive_sha256': digest(directory / 'source.tar.gz'),
            'app_executable_sha256': digest(app / 'Contents/MacOS/pomotroid') if app else None}


def guest(tart, manifest, *args, **kwargs):
    validate_owner(manifest)
    return call([tart, 'exec', *(['-i'] if 'input' in kwargs or 'stdin' in kwargs else []), manifest['vm_name'], *args], **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create', 'boot', 'provision', 'collect', 'stop', 'exec'))
    parser.add_argument('--tart', default=os.environ.get('TART_BIN', shutil.which('tart')))
    parser.add_argument('--run-id')
    parser.add_argument('--browser', choices=('zen', 'chrome'), default='zen')
    parser.add_argument('--baseline', default='pomotroid-zen-clean')
    parser.add_argument('--config', type=pathlib.Path, default=pathlib.Path(__file__).with_name('config.example.json'))
    parser.add_argument('--app', type=pathlib.Path)
    parser.add_argument('--pass', dest='pass_name', choices=('isolated', 'matching'), default='isolated')
    parser.add_argument('--skip-download', action='store_true')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--command', nargs=argparse.REMAINDER, help='guest command for exec; put this option last')
    args = parser.parse_args()
    if not args.tart:
        raise ValueError('Tart missing: install from https://tart.run/quick-start/ or set TART_BIN')
    call([args.tart, '--version'])
    run_id = args.run_id or str(uuid.uuid4())
    manifest = validate_owner({'run_id': run_id, 'vm_name': 'grace-acceptance-' + run_id})
    directory = RUNS / run_id
    if args.action == 'create':
        if shutil.disk_usage(ROOT).free < 15 * 1024**3:
            raise ValueError('at least 15 GiB free space is required')
        directory.mkdir(parents=True, exist_ok=False)
        # Existing files and unrelated guests are never overwritten or pruned.
        manifest.update(snapshot(directory, args.config.resolve(), args.app.resolve() if args.app else None))
        manifest['baseline'] = args.baseline
        manifest['browser'] = args.browser
        (directory / 'run.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (directory / 'results.json').write_text(json.dumps({'run_id': run_id, 'scenarios': initial_results(args.browser)}, indent=2) + '\n')
        call([args.tart, 'clone', args.baseline, manifest['vm_name']], env={**os.environ, 'TART_NO_AUTO_PRUNE': '1'}, timeout=600)
        print('RUN_ID=' + run_id)
        print('Boot in a separate terminal: python3 scripts/guest-focus/runner.py boot --run-id ' + run_id)
        return
    manifest = validate_owner(json.loads((directory / 'run.json').read_text()))
    if manifest['run_id'] != run_id:
        raise ValueError('manifest identity mismatch')
    if args.action == 'boot':
        # Keep this command alive; the caller owns the graphical VM process.
        subprocess.run([args.tart, 'run', '--no-clipboard', '--no-audio', manifest['vm_name']], check=True)
    elif args.action == 'exec':
        if not args.command:
            raise ValueError('--command is required')
        guest(args.tart, manifest, '/usr/bin/env', 'POMOTROID_DISPOSABLE_GUEST=1',
              'POMOTROID_DISPOSABLE_RUN_ID=' + run_id, *args.command, timeout=1800)
    elif args.action == 'stop':
        call([args.tart, 'stop', manifest['vm_name']])
        call([args.tart, 'list'])
    elif args.action == 'provision':
        marker = json.dumps({'run_id': run_id, 'vm_name': manifest['vm_name']}).encode()
        guest(args.tart, manifest, '/usr/bin/python3', '-c',
              'import pathlib,json,sys; p=pathlib.Path("/Users/admin/.grace-disposable-guest.json"); '
              'data=sys.stdin.buffer.read(); '
              'assert not p.exists() or json.loads(p.read_bytes()) == json.loads(data), "foreign guest marker"; '
              'p.write_bytes(data)', input=marker)
        work = '/Users/admin/grace-acceptance/' + run_id
        guest(args.tart, manifest, '/bin/mkdir', '-p', work)
        if should_transfer(args.resume, args.skip_download):
            if digest(directory / 'source.tar.gz') != manifest['archive_sha256']:
                raise ValueError('source archive digest mismatch')
            with (directory / 'source.tar.gz').open('rb') as stream:
                guest(args.tart, manifest, '/usr/bin/tar', '-xzf', '-', '-C', work, stdin=stream)
        command = ['/usr/bin/env', 'POMOTROID_DISPOSABLE_GUEST=1', '/usr/bin/python3', work + '/source/scripts/guest-focus/provision.py', '--config', work + '/config.json', '--source', work + '/source', '--run-id', run_id, '--pass', args.pass_name]
        if manifest.get('browser') == 'chrome':
            command = ['/usr/bin/env', 'POMOTROID_DISPOSABLE_GUEST=1', '/usr/bin/python3', work + '/source/scripts/guest-focus/chrome.py', '--source', work + '/source', '--run-id', run_id]
        guest(args.tart, manifest, *command, *provision_flags(args.resume, args.skip_download), timeout=1800)
    elif args.action == 'collect':
        # Copy only the known run's reports; browser profiles and raw credentials stay in the guest.
        work = '/Users/admin/grace-acceptance/' + run_id
        result = guest(args.tart, manifest, '/usr/bin/find', work, '-maxdepth', '1', '-type', 'f', '-name', '*.json', capture_output=True)
        for item in result.stdout.decode().splitlines():
            path = pathlib.PurePosixPath(item)
            if str(path.parent) == work and collectable(path.name):
                data = guest(args.tart, manifest, '/usr/bin/python3', '-c', 'import sys; f=open(sys.argv[1],"rb"); data=f.read(2097153); assert len(data)<=2097152, "report too large"; sys.stdout.buffer.write(data)', item, capture_output=True).stdout
                report = sanitize_report(json.loads(data))
                (directory / path.name).write_text(json.dumps(report, indent=2) + '\n')
        captures = guest(args.tart, manifest, '/usr/bin/find', work, '-maxdepth', '1', '-type', 'f', '-name', 'native-*.txt', capture_output=True)
        for item in captures.stdout.decode().splitlines():
            path = pathlib.PurePosixPath(item)
            if str(path.parent) == work and re.fullmatch(r'native-[a-z-]+[.]txt', path.name):
                data = guest(args.tart, manifest, '/usr/bin/python3', '-c', 'import sys; data=open(sys.argv[1],"rb").read(524289); assert len(data)<=524288; sys.stdout.buffer.write(data)', item, capture_output=True).stdout
                (directory / path.name).write_text(sanitize_native(data.decode()))
        print(directory)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print('Acceptance runner failed: ' + str(error), file=sys.stderr)
        sys.exit(1)

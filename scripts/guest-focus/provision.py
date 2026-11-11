#!/usr/bin/env python3
"""Provision a deliberately disposable Tart guest; never run on a host Mac."""
import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlparse

ZEN_URL = 'https://github.com/zen-browser/desktop/releases/download/1.24.1b/zen.macos-universal.dmg'
DISCORD_URL = 'https://discord.com/api/download?platform=osx'
MARKER = Path('/Users/admin/.grace-disposable-guest.json')
ROOT = Path('/Users/admin/grace-acceptance')
PREFS = {'browser.startup.page', 'browser.startup.homepage_override.mstone',
         'network.trr.mode', 'network.trr.bootstrapAddress',
         'zen.view.compact', 'zen.view.sidebar-expanded', 'zen.tabs.vertical',
         'zen.theme.content-element-separation'}
ID = re.compile(r'^[A-Za-z0-9._@{}+-]+$')
HASH = re.compile(r'^[0-9a-f]{64}$')


def validate_config(config):
    if not isinstance(config, dict) or set(config) - {'zen', 'discord', 'preferences', 'extensions'}:
        raise ValueError('invalid config keys')
    zen, discord = config.get('zen', {}), config.get('discord', {})
    if not isinstance(zen, dict) or set(zen) - {'version', 'url', 'sha256'} or zen.get('version') != '1.24.1b' or zen.get('url') != ZEN_URL:
        raise ValueError('Zen must use the pinned official release')
    if not isinstance(discord, dict) or set(discord) - {'url', 'sha256', 'version'} or discord.get('url') != DISCORD_URL:
        raise ValueError('Discord must use the official download URL')
    for app in (zen, discord):
        if 'sha256' in app and (not isinstance(app['sha256'], str) or not HASH.fullmatch(app['sha256'])):
            raise ValueError('invalid sha256')
    prefs = config.get('preferences', {})
    if not isinstance(prefs, dict) or any(k not in PREFS or type(v) not in (bool, int) for k, v in prefs.items()):
        raise ValueError('preference not allowed or not a boolean/integer')
    extensions = config.get('extensions', [])
    if not isinstance(extensions, list):
        raise ValueError('extensions must be a list')
    seen = {'focus@pomotroid.local'}
    for ext in extensions:
        if not isinstance(ext, dict) or set(ext) != {'id', 'name', 'version', 'url', 'sha256', 'enabled', 'competing_blocker'}:
            raise ValueError('invalid extension fields')
        if not all(isinstance(ext[k], str) and ext[k] for k in ('id', 'name', 'version', 'url', 'sha256')) or not ID.fullmatch(ext['id']) or ext['id'] in seen or not HASH.fullmatch(ext['sha256']):
            raise ValueError('invalid extension identity or digest')
        u = urlparse(ext['url'])
        if u.scheme != 'https' or u.hostname != 'addons.mozilla.org' or u.port not in (None, 443) or u.username or u.password or not u.path.startswith('/firefox/downloads/') or u.fragment:
            raise ValueError('extension must use an official AMO download URL')
        if type(ext['enabled']) is not bool or type(ext['competing_blocker']) is not bool:
            raise ValueError('extension flags must be boolean')
        seen.add(ext['id'])
    return config


def guard_guest(run_id):
    try:
        if str(uuid.UUID(run_id)) != run_id:
            raise ValueError('run ID must be a canonical UUID')
    except (ValueError, AttributeError):
        raise ValueError('run ID must be a canonical UUID')
    if os.environ.get('POMOTROID_DISPOSABLE_GUEST') != '1' or platform.system() != 'Darwin' or os.geteuid() == 0 or Path.home() != Path('/Users/admin'):
        raise ValueError('requires a non-root opted-in admin macOS guest')
    marker = json.loads(MARKER.read_text())
    if marker.get('run_id') != run_id or not isinstance(marker.get('vm_name'), str) or not marker['vm_name'].strip():
        raise ValueError('guest marker does not match run ID or lacks VM name')
    return marker


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def enabled_extensions_complete(extensions):
    return all(not ext['enabled'] or ext.get('status') == 'available' for ext in extensions)


def extension_policy(extensions, pass_name, companion):
    result = {'focus@pomotroid.local': {'installation_mode': 'force_installed', 'install_url': companion.as_uri()}}
    for ext in extensions:
        if ext.get('status') == 'unavailable':
            continue
        blocked = not ext['enabled'] or (pass_name == 'isolated' and ext['competing_blocker'])
        result[ext['id']] = {'installation_mode': 'blocked'} if blocked else {'installation_mode': 'force_installed', 'install_url': ext['local_path']}
    return result


def policy_plist(extensions, pass_name, companion):
    return plistlib.dumps({'ExtensionSettings': extension_policy(extensions, pass_name, companion)})


def verify_prior_install(previous, executable, version, spec):
    if not isinstance(previous, dict) or previous.get('version') != version or previous.get('executable_sha256') != sha(executable) or (spec.get('version') and spec['version'] != version) or (spec.get('url') and previous.get('url') != spec['url']) or (spec.get('sha256') and previous.get('dmg_sha256') != spec['sha256']):
        raise ValueError('installed app does not match prior provision record')
    return dict(previous)


def load_app_record(path, run_id, vm_name):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.geteuid():
        raise ValueError('missing owned prior app record')
    record = json.loads(path.read_text())
    if record.get('run_id') != run_id or record.get('vm_name') != vm_name or not isinstance(record.get('apps'), dict):
        raise ValueError('prior app record does not match this guest')
    return record


def run(*args):
    subprocess.run(args, check=True, timeout=600)


def download(url, destination, expected=None, retry=False):
    # Protocol restriction applies to redirects as well. curl writes the final URL for audit.
    retry_args = ['--retry', '2', '--retry-max-time', '60'] if retry else []
    result = subprocess.run(['curl', *retry_args, '--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '30', '--max-time', '600', '--silent', '--show-error', '--output', str(destination), '--write-out', '%{url_effective}', url], check=True, capture_output=True, text=True, timeout=610)
    digest = sha(destination)
    if expected and digest != expected:
        destination.unlink()
        raise ValueError('download digest mismatch')
    return digest, result.stdout


def companion_artifact(source):
    base = source / 'extensions' / 'signed' / 'firefox'
    artifact = base / 'focus@pomotroid.local.xpi'
    provenance = json.loads((base / 'provenance.json').read_text())
    if provenance.get('id') != 'focus@pomotroid.local' or provenance.get('channel') != 'unlisted' or provenance.get('sha256') != sha(artifact):
        raise ValueError('companion provenance mismatch')
    with zipfile.ZipFile(artifact) as z:
        names = z.namelist()
        manifest = json.loads(z.read('manifest.json'))
        if len(names) != len(set(names)) or not ({'META-INF/mozilla.rsa', 'META-INF/cose.sig'} & set(names)) or manifest.get('browser_specific_settings', {}).get('gecko', {}).get('id') != 'focus@pomotroid.local' or manifest.get('version') != provenance.get('version'):
            raise ValueError('companion archive identity or signature marker mismatch')
        source_manifest = json.loads((source / 'extensions/firefox/manifest.json').read_text())
        shared = source / 'extensions/focus'
        expected = {p.relative_to(shared).as_posix(): p.read_bytes() for p in shared.rglob('*') if p.is_file()}
        payload = {n for n in names if not n.endswith('/') and not n.startswith('META-INF/') and n != 'manifest.json'}
        if manifest != source_manifest or payload != set(expected) or any(z.read(n) != data for n, data in expected.items()):
            raise ValueError('companion archive differs from source')
    return artifact, provenance


def verify_identity(path, name):
    team, identifier = {
        'Zen': ('9V5K9TP787', 'app.zen-browser.zen'),
        'Discord': ('53Q6R32WPB', 'com.hnc.Discord'),
    }[name]
    requirement = f'=anchor apple generic and certificate leaf[subject.OU] = "{team}" and identifier "{identifier}"'
    run('codesign', '--verify', '--strict', '--requirement', requirement, str(path))


def stage_app(name, source, stage, destination):
    if destination.exists() or destination.is_symlink():
        raise ValueError(f'{destination} already exists; refusing to overwrite')
    run('ditto', '--norsrc', '--noextattr', str(source), str(stage))
    run('codesign', '--verify', '--deep', '--strict', str(stage))
    verify_identity(stage, name)
    run('ditto', str(stage), str(destination))


def install_app(name, spec, work, skip, previous=None):
    app = Path('/Applications') / (name + '.app')
    dmg = work / (name.lower() + '.dmg')
    digest = final_url = None
    if not skip:
        digest, final_url = download(spec['url'], dmg, spec.get('sha256'))
        mount = work / ('mount-' + name.lower())
        mount.mkdir(exist_ok=True)
        run('hdiutil', 'attach', str(dmg), '-nobrowse', '-readonly', '-mountpoint', str(mount))
        try:
            source_app = mount / (name + '.app')
            with tempfile.TemporaryDirectory(prefix='stage-', dir=work) as temp:
                stage_app(name, source_app, Path(temp) / (name + '.app'), app)
        finally:
            run('hdiutil', 'detach', str(mount))
    if not app.is_dir():
        raise ValueError(f'{app} is missing')
    run('codesign', '--verify', '--deep', '--strict', str(app))
    verify_identity(app, name)
    with (app / 'Contents/Info.plist').open('rb') as f:
        info = plistlib.load(f)
    version = info['CFBundleShortVersionString']
    executable = app / 'Contents/MacOS' / info['CFBundleExecutable']
    if skip:
        return verify_prior_install(previous, executable, version, spec)
    if spec.get('version') and version != spec['version']:
        raise ValueError(f'{name} installed version {version} does not match requested version')
    return {'url': spec['url'], 'final_url': final_url, 'dmg_sha256': digest, 'version': version, 'executable_sha256': sha(executable)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--pass', dest='pass_name', choices=('isolated', 'matching'), default='isolated')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--skip-download', action='store_true')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    marker = guard_guest(args.run_id)
    config = validate_config(json.loads(args.config.read_text()))
    companion, provenance = companion_artifact(args.source.resolve())
    for dep in ('curl', 'hdiutil', 'codesign', 'ditto'):
        if not shutil.which(dep):
            raise ValueError(f'missing dependency: {dep}')
    if args.check:
        print('Guest marker, configuration, companion and dependencies validated; no changes made.')
        return
    work = ROOT / args.run_id
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if ROOT.is_symlink() or ROOT.resolve() != ROOT or ROOT.stat().st_uid != os.geteuid():
        raise ValueError('unsafe acceptance directory')
    work.mkdir(mode=0o700, exist_ok=True)
    if work.is_symlink() or work.resolve() != work or work.stat().st_uid != os.geteuid():
        raise ValueError('unsafe work directory')
    # A running browser may overwrite preferences or retain old enterprise policies.
    processes = subprocess.run(['/usr/bin/pgrep', '-f', r'^/Applications/Zen[.]app/Contents/MacOS/'], capture_output=True, timeout=10)
    if processes.returncode == 0:
        raise ValueError('close Zen before provisioning')
    if processes.returncode != 1:
        raise ValueError('could not check whether Zen is running')
    record_path = work / 'apps.json'
    record = {'run_id': args.run_id, 'vm_name': marker['vm_name'], 'apps': {}}
    if args.skip_download or args.resume:
        record = load_app_record(record_path, args.run_id, marker['vm_name'])
    elif record_path.exists() or record_path.is_symlink():
        raise ValueError('existing app record; use --resume')
    apps = record['apps']
    for name in ('Zen', 'Discord'):
        installed = (Path('/Applications') / (name + '.app')).exists()
        use_existing = args.skip_download or (args.resume and installed)
        apps[name] = install_app(name, config[name.lower()], work, use_existing, apps.get(name))
        # Record each verified app immediately so interrupted runs can resume safely.
        temporary = work / 'apps.json.tmp'
        if temporary.is_symlink():
            raise ValueError('unsafe temporary app record')
        temporary.write_text(json.dumps(record, indent=2) + '\n')
        os.replace(temporary, record_path)
    local_companion = work / 'companion.xpi'
    shutil.copyfile(companion, local_companion)
    extensions = []
    for i, ext in enumerate(config.get('extensions', [])):
        target = work / f'extension-{i}.xpi'
        try:
            digest, final = download(ext['url'], target, ext['sha256'], retry=True)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            target.unlink(missing_ok=True)
            extensions.append({**ext, 'status': 'unavailable', 'reason': f'download failed ({type(exc).__name__})'})
            continue
        host = urlparse(final).hostname
        if host not in ('addons.mozilla.org', 'addons.cdn.mozilla.net'):
            raise ValueError('AMO extension redirected to an unexpected host')
        with zipfile.ZipFile(target) as z:
            manifest = json.loads(z.read('manifest.json'))
            gecko = manifest.get('browser_specific_settings', manifest.get('applications', {})).get('gecko', {})
            if gecko.get('id') != ext['id'] or manifest.get('version') != ext['version'] or not ({'META-INF/mozilla.rsa', 'META-INF/cose.sig'} & set(z.namelist())):
                raise ValueError('extension identity, version or signature marker mismatch')
        extensions.append({**ext, 'status': 'available', 'local_path': target.as_uri(), 'download_sha256': digest, 'final_url': final})
    profile = work / 'profile'
    profile.mkdir(exist_ok=True)
    (profile / 'user.js').write_text(''.join('user_pref(' + json.dumps(k) + ', ' + json.dumps(v) + ');\n' for k, v in sorted(config.get('preferences', {}).items())))
    profiles_ini = Path.home() / 'Library/Application Support/zen/profiles.ini'
    profiles_ini.parent.mkdir(parents=True, exist_ok=True)
    expected = '[General]\nStartWithLastProfile=1\nVersion=2\n\n[Profile0]\nName=Grace acceptance\nIsRelative=0\nPath=' + str(profile) + '\nDefault=1\n'
    if profiles_ini.exists() and profiles_ini.read_text() != expected:
        raise ValueError('existing Zen profiles.ini; refusing to overwrite')
    profiles_ini.write_text(expected)
    policy = work / 'zen-policy.plist'
    policy.write_bytes(policy_plist(extensions, args.pass_name, local_companion))
    run('/usr/bin/defaults', 'import', 'app.zen-browser.zen', str(policy))
    (work / 'provision.json').write_text(json.dumps({'run_id': args.run_id, 'vm_name': marker['vm_name'], 'pass': args.pass_name, 'apps': apps, 'companion': {'sha256': sha(local_companion), 'version': provenance['version']}, 'extensions': extensions, 'enabled_extensions_complete': enabled_extensions_complete(extensions)}, indent=2) + '\n')
    if args.pass_name == 'matching' and not enabled_extensions_complete(extensions):
        missing = ', '.join(ext['id'] for ext in extensions if ext['enabled'] and ext.get('status') != 'available')
        raise ValueError(f'matching pass blocked: enabled extensions unavailable: {missing}; retry provisioning after restoring downloads')
    print(f'Provisioned {work}; launch Zen and complete companion consent in the UI.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile) as exc:
        print(f'Provisioning failed: {exc}', file=sys.stderr)
        sys.exit(1)

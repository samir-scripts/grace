#!/usr/bin/env python3
"""Prepare official Chrome and an empty profile only inside an owned Tart guest."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile

import provision

URL = 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg'
EXTENSION_ID = 'ddiojihepmbimcfoefnebpolgaljlcfn'


def extension_identity(manifest):
    key = json.loads(manifest.read_text())['key']
    digest = hashlib.sha256(base64.b64decode(key, validate=True)).hexdigest()[:32]
    return ''.join(chr(97 + int(n, 16)) for n in digest)


def initial_results():
    return [{'id': name, 'status': 'blocked', 'reason': 'Native UI acceptance not observed.'}
            for name in ('unpacked-install', 'native-pairing', 'consent', 'profile-assignment',
                         'existing-tabs', 'fresh-http', 'fresh-https', 'allowed-controls',
                         'break-restoration', 'work-reapplication', 'worker-restart',
                         'browser-restart', 'desktop-restart', 'disconnect-retry',
                         'natural-completion', 'protected-restart', 'emergency-release',
                         'consent-withdrawal', 'appearance-keyboard')]


def prepare_profile(profile, resume):
    if profile.is_symlink() or profile.resolve() != profile:
        raise ValueError('unsafe Chrome profile path')
    if profile.exists() and (profile.stat().st_uid != os.geteuid() or (not resume and any(profile.iterdir()))):
        raise ValueError('Chrome profile is not empty or owned')
    profile.mkdir(mode=0o700, exist_ok=True)


def verify(app):
    provision.run('/usr/bin/codesign', '--verify', '--deep', '--strict', str(app))
    # Google LLC Developer ID. Require the designated identifier and signing team.
    provision.run('/usr/bin/codesign', '--verify', '-R',
                  '=anchor apple generic and identifier "com.google.Chrome" and certificate leaf[subject.OU] = "EQHXZ8M8AV"', str(app))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--skip-download', action='store_true')
    args = parser.parse_args()
    marker = provision.guard_guest(args.run_id)
    work = provision.ROOT / args.run_id
    if work.is_symlink() or work.resolve() != work or not work.is_dir() or work.stat().st_uid != os.geteuid():
        raise ValueError('unsafe owned work directory')
    source = args.source.resolve()
    if source != work / 'source':
        raise ValueError('source must be inside the owned run')
    if extension_identity(source / 'extensions/chrome/manifest.json') != EXTENSION_ID:
        raise ValueError('unexpected Chrome extension identity')
    check = subprocess.run(['/usr/bin/pgrep', '-f', '^/Applications/Google Chrome[.]app/Contents/MacOS/'], capture_output=True)
    if check.returncode != 1:
        raise ValueError('close Chrome before provisioning or process check failed')
    profile = work / 'chrome-profile'
    prepare_profile(profile, args.resume or args.skip_download)
    app = Path('/Applications/Google Chrome.app')
    record_path = work / 'chrome-provision.json'
    previous = json.loads(record_path.read_text()) if record_path.exists() else None
    if previous and (previous['run_id'] != args.run_id or previous['vm_name'] != marker['vm_name']):
        raise ValueError('foreign Chrome provisioning record')
    if app.exists():
        if not (args.resume or args.skip_download) or not previous:
            raise ValueError('refusing unrecorded or existing Chrome installation')
        verify(app)
        if provision.sha(app / 'Contents/MacOS/Google Chrome') != previous['executable_sha256']:
            raise ValueError('Chrome changed since provisioning')
        return
    if args.skip_download:
        raise ValueError('Chrome installation is missing')
    dmg = work / 'chrome.dmg'
    digest, final_url = provision.download(URL, dmg, retry=True)
    mount = work / 'mount-chrome'
    mount.mkdir(exist_ok=True)
    provision.run('hdiutil', 'attach', str(dmg), '-nobrowse', '-readonly', '-mountpoint', str(mount))
    try:
        with tempfile.TemporaryDirectory(prefix='chrome-stage-', dir=work) as temp:
            stage = Path(temp) / 'Google Chrome.app'
            provision.run('ditto', '--norsrc', '--noextattr', str(mount / 'Google Chrome.app'), str(stage))
            verify(stage)
            provision.run('ditto', str(stage), str(app))
    finally:
        provision.run('hdiutil', 'detach', str(mount))
    verify(app)
    with (app / 'Contents/Info.plist').open('rb') as stream:
        version = plistlib.load(stream)['CFBundleShortVersionString']
    report = {'run_id': args.run_id, 'vm_name': marker['vm_name'], 'url': URL,
              'final_url': final_url, 'dmg_sha256': digest, 'version': version,
              'macos': subprocess.check_output(['sw_vers', '-productVersion'], text=True).strip(),
              'executable_sha256': provision.sha(app / 'Contents/MacOS/Google Chrome'),
              'extension_id': EXTENSION_ID, 'profile': str(profile), 'scenarios': initial_results()}
    record_path.write_text(json.dumps(report, indent=2) + '\n')
    print('Official Chrome verified; empty owned profile ready. Native acceptance remains blocked.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError):
        raise SystemExit('Chrome guest provisioning failed; inspect guest state without exporting credentials.')

#!/usr/bin/env python3
"""Observe retained Zen tabs through the guest's authorized address bar."""
import argparse
import datetime
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import provision

DEFAULT_DOMAINS = {'example.com', 'youtube.com', 'instagram.com', 'reddit.com'}
ID = 'focus@pomotroid.local'
SCRIPT = '''on run argv
 set the clipboard to ""
 tell application "System Events"
  tell process "zen" to set frontmost to true
  keystroke (item 1 of argv) using command down
  delay 0.25
  keystroke "l" using command down
  delay 0.15
  keystroke "c" using command down
 end tell
 delay 0.25
 return the clipboard as text
end run'''


def parse_blocked(value, extension_uuid, domains):
    try:
        page = urlparse(value)
        if page.scheme != 'moz-extension' or page.netloc != extension_uuid or page.path != '/blocked.html' or page.fragment:
            return None
        params = parse_qs(page.query, strict_parsing=True)
        if set(params) != {'url'} or len(params['url']) != 1:
            return None
        original = params['url'][0]
        url = urlparse(original)
        host = url.hostname or ''
        if url.scheme not in ('http', 'https') or url.username or url.password or not any(host == d or host.endswith('.' + d) for d in domains):
            return None
        return original
    except (ValueError, TypeError):
        return None


def deduplicate_observations(observations):
    seen = set()
    unique = []
    for item in observations:
        target = item.get('original_target')
        if item.get('status') == 'blocked-existing' and target:
            if target in seen:
                continue
            seen.add(target)
        unique.append(item)
    return unique, len(seen)


def owned_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.geteuid() or path.resolve() != path:
        raise ValueError('unsafe guest file')
    return path


def companion_identity(work, record):
    profile = work / 'profile'
    inventory = json.loads(owned_file(profile / 'extensions.json').read_text())
    addons = [a for a in inventory.get('addons', []) if a.get('id') == ID]
    if len(addons) != 1 or not addons[0].get('active') or addons[0].get('userDisabled') or addons[0].get('appDisabled') or addons[0].get('signedState') != 2 or addons[0].get('location') in ('temporary', 'app-temporary', None):
        raise ValueError('signed companion is not active and persistent')
    artifact = owned_file(profile / 'extensions' / (ID + '.xpi'))
    if provision.sha(artifact) != record['companion']['sha256']:
        raise ValueError('installed companion digest differs from provision record')
    prefs = owned_file(profile / 'prefs.js').read_text()
    match = re.search(r'^user_pref\("extensions\.webextensions\.uuids",\s*("(?:\\.|[^"\\])*")\);$', prefs, re.M)
    if not match:
        raise ValueError('companion identity unavailable')
    identity = json.loads(json.loads(match.group(1))).get(ID)
    if not isinstance(identity, str) or str(uuid.UUID(identity)) != identity:
        raise ValueError('invalid companion identity')
    return identity


def target_domains(path, work):
    if path is None:
        return DEFAULT_DOMAINS
    path = Path(os.path.abspath(path))
    if not path.is_relative_to(work):
        raise ValueError('target config must be inside work directory')
    config = json.loads(owned_file(path).read_text())
    targets = config.get('blocked')
    if not isinstance(targets, list) or not targets or len(targets) > 256:
        raise ValueError('invalid blocked targets')
    domains = set()
    for target in targets:
        parsed = urlparse(target)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or not re.fullmatch(r'[a-z0-9.-]+', parsed.hostname):
            raise ValueError('invalid blocked target')
        domains.add(parsed.hostname)
    return domains


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--pass', dest='pass_name', choices=('matching', 'isolated'), required=True)
    parser.add_argument('--tabs', type=int, default=3, choices=range(1, 10))
    parser.add_argument('--targets', type=Path)
    args = parser.parse_args()
    marker = provision.guard_guest(args.run_id)
    work = provision.ROOT / args.run_id
    if work.is_symlink() or work.resolve() != work or work.stat().st_uid != os.geteuid():
        raise ValueError('unsafe work directory')
    record = json.loads(owned_file(work / 'provision.json').read_text())
    if record.get('run_id') != args.run_id or record.get('vm_name') != marker['vm_name'] or record.get('pass') != args.pass_name or (args.pass_name == 'matching' and record.get('enabled_extensions_complete') is not True):
        raise ValueError('provision record mismatch or incomplete')
    identity = companion_identity(work, record)
    domains = target_domains(args.targets, work)
    observations = []
    try:
        for index in range(1, args.tabs + 1):
            result = subprocess.run(['/usr/bin/osascript', '-e', SCRIPT, str(index)], capture_output=True, text=True, timeout=10, check=True)
            original = parse_blocked(result.stdout.strip(), identity, domains)
            observations.append({'tab_index': index, 'status': 'blocked-existing', 'original_target': original} if original else {'tab_index': index, 'status': 'inconclusive'})
    finally:
        subprocess.run(['/usr/bin/osascript', '-e', 'set the clipboard to ""'], capture_output=True, timeout=5, check=False)
    observations, distinct_count = deduplicate_observations(observations)
    result = {'requested_tab_count': args.tabs, 'distinct_verified_targets': distinct_count, 'run_id': args.run_id, 'vm_name': marker['vm_name'], 'pass': args.pass_name, 'phase': 'work', 'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'companion_verified': True, 'observations': observations, 'status': 'observation-only', 'pending': 'Correlate with active timer UI and authenticated active policy ACK.'}
    destination = work / f'scenario-{args.pass_name}-work-existing-tabs-{uuid.uuid4()}.json'
    with destination.open('x') as out:
        os.chmod(destination, 0o600)
        json.dump(result, out, indent=2)
        out.write('\n')
    print(destination)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        print('Existing tabs observation blocked: ' + str(exc) if not isinstance(exc, subprocess.SubprocessError) else 'Existing tabs observation blocked: UI automation failed', file=__import__('sys').stderr)
        raise SystemExit(1)

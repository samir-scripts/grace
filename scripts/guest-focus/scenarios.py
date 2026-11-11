#!/usr/bin/env python3
"""Record guarded guest Discord observations; native UI acceptance remains manual."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

import provision

DISCORD = Path('/Applications/Discord.app/Contents/MacOS/Discord')


def classify(phase, existing, terminated):
    if phase == 'work':
        if existing:
            return 'fail'
        if len(terminated) != 3:
            return 'inconclusive'
        return 'pass' if all(terminated) else 'fail'
    if len(terminated) != 1 or terminated[0]:
        return 'inconclusive'
    return 'pass'


def native_evidence_status(ui_file):
    return 'inconclusive' if ui_file else 'blocked'


def find_pids(pattern, exact=False):
    result = subprocess.run(['/usr/bin/pgrep', '-fx' if exact else '-f', pattern], capture_output=True, text=True, timeout=10)
    if result.returncode not in (0, 1):
        raise RuntimeError('could not inspect Discord processes')
    return [int(pid) for pid in result.stdout.split()]


def discord_pids():
    return find_pids(re.escape(str(DISCORD)), exact=True)


def helper_pids():
    return find_pids('^' + re.escape('/Applications/Discord.app/Contents/Frameworks/'))


def observe_launch(seconds):
    started = time.monotonic()
    child = subprocess.Popen([str(DISCORD)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        try:
            exit_code = child.wait(timeout=seconds)
            terminated = True
        except subprocess.TimeoutExpired:
            exit_code = None
            terminated = False
        elapsed_ms = round((time.monotonic() - started) * 1000)
        return {'pid': child.pid, 'terminated': terminated, 'elapsed_ms': elapsed_ms,
                'exit_code': exit_code, 'helper_pids': helper_pids()}
    finally:
        # Only the directly spawned, still-unreaped child can be signalled.
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                # Never escalate to a force quit; leave this child for manual cleanup.
                pass


def owned_file(path):
    return path.is_file() and not path.is_symlink() and path.stat().st_uid == os.geteuid()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--phase', choices=('baseline', 'work', 'break', 'released'), required=True)
    parser.add_argument('--pass', dest='pass_name', choices=('isolated', 'matching'), required=True)
    parser.add_argument('--app', type=Path, required=True, help='packaged Grace executable')
    parser.add_argument('--ui-file', type=Path, help='optional native UI evidence for manual review')
    parser.add_argument('--active-evidence', type=Path, help='native work-state evidence for manual review; required for work probes')
    args = parser.parse_args()
    marker = provision.guard_guest(args.run_id)
    work = provision.ROOT / args.run_id
    if work.is_symlink() or work.resolve() != work or not work.is_dir() or work.stat().st_uid != os.geteuid():
        raise ValueError('unsafe or missing guest work directory')
    record = work / 'provision.json'
    if not owned_file(record):
        raise ValueError('missing owned provision record')
    data = json.loads(record.read_text())
    if (data.get('run_id'), data.get('vm_name'), data.get('pass')) != (args.run_id, marker['vm_name'], args.pass_name):
        raise ValueError('provision record does not match run, guest and pass')
    if args.pass_name == 'matching' and data.get('enabled_extensions_complete') is not True:
        raise ValueError('matching pass blocked: enabled extension setup is incomplete')
    if not args.app.is_file() or not os.access(args.app, os.X_OK):
        raise ValueError('packaged app executable is missing')
    expected = data.get('apps', {}).get('Discord', {}).get('executable_sha256')
    if not DISCORD.is_file() or provision.sha(DISCORD) != expected:
        raise ValueError('Discord executable differs from provision record')
    if args.ui_file and not args.ui_file.is_file():
        raise ValueError('UI evidence file is missing')
    if args.phase == 'work' and (not args.active_evidence or not args.active_evidence.is_file()):
        raise ValueError('work probes require native active-state evidence for manual review')
    initial = discord_pids()
    initial_helpers = helper_pids()
    if args.phase != 'work' and initial:
        raise ValueError('close pre-existing Discord before this observation')
    if args.phase == 'work':
        deadline = time.monotonic() + 4
        while discord_pids() and time.monotonic() < deadline:
            time.sleep(0.1)
        remaining = discord_pids()
        remaining_helpers = helper_pids()
        launches = [observe_launch(4) for _ in range(3)] if not remaining else []
    else:
        remaining = []
        remaining_helpers = initial_helpers
        launches = [observe_launch(3)]
    terminated = [launch['terminated'] for launch in launches]
    result = {
        'run_id': args.run_id, 'vm_name': marker['vm_name'], 'pass': args.pass_name,
        'phase': args.phase, 'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'app': str(args.app.resolve()), 'app_sha256': provision.sha(args.app),
        'discord_sha256': expected, 'initial_pids': initial, 'remaining_pids': remaining,
        'initial_helper_pids': initial_helpers, 'remaining_helper_pids': remaining_helpers,
        'launches': launches, 'launch_terminated_within_limit': terminated,
        'process_observation': classify(args.phase, bool(remaining), terminated),
        'native_ui_evidence': {'status': native_evidence_status(args.ui_file), 'path': str(args.ui_file.resolve()) if args.ui_file else None},
        'active_evidence': str(args.active_evidence.resolve()) if args.active_evidence else None,
        'acceptance': 'blocked',
        'pending': ['Verify native selected profile, timer and locked state with fresh signed policy ACK.',
                    'Review UI evidence and browser behavior; a process exit alone may be an updater failure.',
                    'Confirm natural break and release restoration through the native application.'],
    }
    destination = work / f'scenario-{args.pass_name}-{args.phase}-{uuid.uuid4()}.json'
    with destination.open('x') as out:
        json.dump(result, out, indent=2)
        out.write('\n')
    print(destination)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f'Scenario blocked: {exc}', file=sys.stderr)
        sys.exit(1)

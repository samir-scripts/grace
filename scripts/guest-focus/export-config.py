#!/usr/bin/env python3
"""Export only public extension identities/digests and allowlisted scalar preferences."""
import argparse
import hashlib
import json
import pathlib
import re
import sys
from urllib.parse import urlparse

from provision import PREFS, ZEN_URL, DISCORD_URL, validate_config


def export(profile):
    inventory = json.loads((profile / 'extensions.json').read_text())
    extensions = []
    omitted = []
    for item in inventory.get('addons', []):
        if item.get('type') != 'extension' or item.get('isSystem'):
            continue
        url = item.get('sourceURI')
        if not url:
            continue  # Browser-owned built-ins come from the pinned Zen installation.
        parsed = urlparse(url)
        path = pathlib.Path(item.get('path', ''))
        if parsed.scheme != 'https' or parsed.hostname != 'addons.mozilla.org' or not parsed.path.startswith('/firefox/downloads/') or not path.is_file():
            omitted.append(item['id'])
            continue
        extensions.append({'id': item['id'], 'name': item.get('defaultLocale', {}).get('name', item['id']),
                           'version': item['version'], 'url': url,
                           'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'enabled': bool(item.get('active')),
                           'competing_blocker': item['id'] in {
                               'leechblockng@proginosko.com', 'uBlock0@raymondhill.net',
                               'jid1-MnnxcxisBPnSXQ@jetpack', 'firefox@tampermonkey.net',
                               '{74145f27-f039-47ce-a470-a662b129930a}', 'myallychou@gmail.com'}})
    preferences = {}
    for line in (profile / 'prefs.js').read_text().splitlines():
        match = re.fullmatch(r'user_pref\(("[^"\\]+"), (true|false|-?\d+)\);', line)
        if match:
            key, value = json.loads(match[1]), json.loads(match[2])
            if key in PREFS:
                preferences[key] = value
    preferences['browser.startup.page'] = 0
    config = {'zen': {'version': '1.24.1b', 'url': ZEN_URL},
              'discord': {'url': DISCORD_URL}, 'preferences': preferences, 'extensions': extensions}
    validate_config(config)
    return config, omitted


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    config, omitted = export(args.profile)
    args.output.write_text(json.dumps(config, indent=2) + '\n')
    print(f'Exported {len(config["extensions"])} public extension entries and {len(config["preferences"])} preferences.')
    if omitted:
        print('Unavailable public artifacts: ' + ', '.join(omitted), file=sys.stderr)

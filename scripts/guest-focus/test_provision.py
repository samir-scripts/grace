import importlib.util
import unittest
import plistlib
import tempfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('provision', Path(__file__).with_name('provision.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ProvisionTests(unittest.TestCase):
    def config(self):
        return {'zen': {'version': '1.24.1b', 'url': p.ZEN_URL},
                'discord': {'url': p.DISCORD_URL}, 'preferences': {}, 'extensions': []}

    def test_rejects_preference_with_private_data(self):
        config = self.config()
        config['preferences'] = {'browser.startup.homepage': 'https://private.example'}
        with self.assertRaises(ValueError):
            p.validate_config(config)

    def test_rejects_non_amo_extension(self):
        config = self.config()
        config['extensions'] = [{'id': 'a@example.org', 'name': 'a', 'version': '1',
            'url': 'https://evil.example/a.xpi', 'sha256': 'a' * 64,
            'enabled': True, 'competing_blocker': False}]
        with self.assertRaises(ValueError):
            p.validate_config(config)

    def test_marker_requires_matching_run_and_explicit_opt_in(self):
        with patch.dict(p.os.environ, {}, clear=True), patch.object(p.platform, 'system', return_value='Darwin'), patch.object(p.os, 'geteuid', return_value=501):
            with self.assertRaises(ValueError):
                p.guard_guest('4c83a270-5a5e-48fc-a6d1-35328fedf802')

    def test_isolated_policy_blocks_competing_extension(self):
        extension = {'id': 'a@example.org', 'url': 'https://addons.mozilla.org/firefox/downloads/file/1/a.xpi',
                     'enabled': True, 'competing_blocker': True}
        policy = p.extension_policy([extension], 'isolated', Path('/tmp/companion.xpi'))
        self.assertEqual(policy['a@example.org']['installation_mode'], 'blocked')
        self.assertEqual(policy['focus@pomotroid.local']['installation_mode'], 'force_installed')

class RepeatTests(unittest.TestCase):
    def test_policy_plist_has_direct_extension_settings(self):
        data = p.policy_plist([], 'isolated', Path('/tmp/companion.xpi'))
        policy = plistlib.loads(data)
        self.assertEqual(policy['ExtensionSettings']['focus@pomotroid.local']['installation_mode'], 'force_installed')
        self.assertNotIn('policies', policy)

    def test_owned_manifest_requires_matching_executable(self):
        with tempfile.TemporaryDirectory() as d:
            executable = Path(d) / 'app'
            executable.write_bytes(b'original')
            previous = {'version': '1', 'executable_sha256': p.sha(executable), 'dmg_sha256': 'old'}
            result = p.verify_prior_install(previous, executable, '1', {})
            self.assertEqual(result['dmg_sha256'], 'old')
            executable.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                p.verify_prior_install(previous, executable, '1', {})

class StagingTests(unittest.TestCase):
    def test_stages_before_strict_verification_and_installation(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            calls = []
            def command(*args):
                calls.append(args)
            with patch.object(p, 'run', side_effect=command), patch.object(p, 'verify_identity', side_effect=lambda path, name: calls.append(('identity', str(path), name))):
                p.stage_app('Zen', base / 'mounted.app', base / 'stage.app', base / 'installed.app')
            self.assertEqual(calls[0], ('ditto', '--norsrc', '--noextattr', str(base / 'mounted.app'), str(base / 'stage.app')))
            self.assertEqual(calls[1], ('codesign', '--verify', '--deep', '--strict', str(base / 'stage.app')))
            self.assertEqual(calls[2], ('identity', str(base / 'stage.app'), 'Zen'))
            self.assertEqual(calls[3], ('ditto', str(base / 'stage.app'), str(base / 'installed.app')))

class AvailabilityTests(unittest.TestCase):
    def test_unavailable_extension_is_not_force_installed(self):
        ext = {'id': 'missing@example.org', 'enabled': True, 'competing_blocker': False, 'status': 'unavailable'}
        policy = p.extension_policy([ext], 'matching', Path('/tmp/companion.xpi'))
        self.assertNotIn(ext['id'], policy)

    def test_resume_record_rejects_other_run(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'apps.json'
            path.write_text('{"run_id":"other","vm_name":"vm","apps":{}}')
            with self.assertRaises(ValueError):
                p.load_app_record(path, 'expected', 'vm')

class CompletenessTests(unittest.TestCase):
    def test_only_enabled_unavailable_extensions_block_readiness(self):
        self.assertFalse(p.enabled_extensions_complete([{'enabled': True, 'status': 'unavailable'}]))
        self.assertTrue(p.enabled_extensions_complete([{'enabled': False, 'status': 'unavailable'}]))
        self.assertTrue(p.enabled_extensions_complete([{'enabled': True, 'status': 'available'}]))

if __name__ == '__main__':
    unittest.main()

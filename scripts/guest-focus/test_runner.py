import importlib.util
import pathlib
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('runner', pathlib.Path(__file__).with_name('runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_paths_never_include_private_or_build_data(self):
        for value in ('.env', 'src/.env.local', 'node_modules/a.js', 'src-tauri/target/debug/a', '.git/config', 'private.key'):
            self.assertFalse(runner.exportable(value), value)
        for value in ('src/routes/+page.svelte', 'scripts/guest-focus/runner.py', 'extensions/signed/firefox/focus@pomotroid.local.xpi'):
            self.assertTrue(runner.exportable(value), value)

    def test_owned_run_requires_exact_vm_and_uuid(self):
        run_id = str(uuid.uuid4())
        manifest = {'run_id': run_id, 'vm_name': 'grace-acceptance-' + run_id}
        self.assertEqual(runner.validate_owner(manifest), manifest)
        for change in ({'vm_name': 'pomotroid-zen-clean'}, {'run_id': '../escape'}):
            with self.assertRaises(ValueError):
                runner.validate_owner({**manifest, **change})

    def test_native_evidence_cannot_pass_by_default(self):
        results = runner.initial_results()
        self.assertTrue(results)
        self.assertTrue(all(item['status'] == 'blocked' for item in results))
        self.assertIn('discord-relaunch', {r['id'] for r in results})


class SafetyTests(unittest.TestCase):
    def test_private_files_denied(self):
        for name in ('src/account.db', 'scripts/private.log', 'src/secrets.json', 'src/id_rsa', 'src/token.txt'):
            self.assertFalse(runner.exportable(name), name)

    def test_report_names_require_known_phase_and_pass(self):
        for name in ('browser-baseline-isolated-123.json', 'browser-released-matching-123.json', 'scenario-isolated-work-123.json', 'provision.json'):
            self.assertTrue(runner.collectable(name), name)
        for name in ('browser-isolated-bogus.json', 'browser-before-other-123.json', 'private.json', '../provision.json'):
            self.assertFalse(runner.collectable(name), name)

    def test_recursively_removes_credentials(self):
        value = {'url': 'https://example.com', 'token': 'secret', 'child': [{'password': 'x', 'ok': 1}]}
        self.assertEqual(runner.sanitize_report(value), {'url': 'https://example.com', 'child': [{'ok': 1}]})

    def test_native_capture_omits_inputs_and_private_profile_identifiers(self):
        captured = 'AXStaticText | 01:59 | 01:59\nAXTextField | Password | secret\nAXStaticText | profile-private | profile-private\nnot an accessibility record\n'
        self.assertEqual(runner.sanitize_native(captured), 'AXStaticText | 01:59 | 01:59\n')

    def test_bundle_rejects_external_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            app = root / 'Grace.app'
            app.mkdir()
            (app / 'external').symlink_to('../outside')
            with self.assertRaises(ValueError):
                runner.validate_app_links(app)

    def test_bundle_allows_relative_internal_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            app = pathlib.Path(d) / 'Grace.app'
            app.mkdir()
            (app / 'target').write_text('data')
            (app / 'link').symlink_to('target')
            runner.validate_app_links(app)

    def test_resume_does_not_transfer_and_forwards_flag(self):
        self.assertFalse(runner.should_transfer(True, False))
        self.assertEqual(runner.provision_flags(True, False), ['--resume'])
        self.assertFalse(runner.should_transfer(False, True))

if __name__ == '__main__':
    unittest.main()

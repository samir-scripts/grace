import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('chrome', pathlib.Path(__file__).with_name('chrome.py'))
chrome = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chrome)


class ChromeTests(unittest.TestCase):
    def test_fixed_identity_matches_public_key(self):
        manifest = pathlib.Path(__file__).resolve().parents[2] / 'extensions/chrome/manifest.json'
        self.assertEqual(chrome.extension_identity(manifest), 'ddiojihepmbimcfoefnebpolgaljlcfn')

    def test_signing_requirement_is_inline_not_a_filename(self):
        with patch.object(chrome.provision, 'run') as run:
            chrome.verify(pathlib.Path('/Applications/Google Chrome.app'))
        args = run.call_args.args
        self.assertEqual(args[2], '-R')
        self.assertTrue(args[3].startswith('=anchor apple generic'))
        self.assertIn('EQHXZ8M8AV', args[3])

    def test_runner_selects_chrome_scenarios_and_collects_only_known_report(self):
        import runner
        self.assertEqual(runner.initial_results('chrome'), chrome.initial_results())
        self.assertTrue(runner.collectable('chrome-provision.json'))
        self.assertFalse(runner.collectable('chrome-profile.json'))

    def test_results_never_infer_acceptance(self):
        self.assertTrue(all(x['status'] == 'blocked' for x in chrome.initial_results()))
        self.assertIn('native-pairing', {x['id'] for x in chrome.initial_results()})

    def test_profile_must_be_owned_and_empty_on_first_provision(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = pathlib.Path(directory).resolve() / 'chrome-profile'
            chrome.prepare_profile(profile, resume=False)
            (profile / 'Preferences').write_text('{}')
            with self.assertRaises(ValueError):
                chrome.prepare_profile(profile, resume=False)
            chrome.prepare_profile(profile, resume=True)
            link = pathlib.Path(directory).resolve() / 'link'
            link.symlink_to(profile, target_is_directory=True)
            with self.assertRaises(ValueError):
                chrome.prepare_profile(link, resume=True)

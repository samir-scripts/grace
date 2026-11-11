import importlib.util
import pathlib
import sys
import unittest
from urllib.parse import quote

sys.path.insert(0, str(pathlib.Path(__file__).parent))
spec = importlib.util.spec_from_file_location('existing_tabs', pathlib.Path(__file__).with_name('existing-tabs.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ExistingTabsTests(unittest.TestCase):
    def test_only_expected_companion_page_and_public_target(self):
        identity = '12345678-1234-1234-1234-123456789abc'
        original = 'https://www.youtube.com/watch?v=example'
        page = f'moz-extension://{identity}/blocked.html?url={quote(original, safe="")}'
        self.assertEqual(p.parse_blocked(page, identity, {'youtube.com'}), original)
        self.assertIsNone(p.parse_blocked(page, '87654321-1234-1234-1234-123456789abc', {'youtube.com'}))
        self.assertIsNone(p.parse_blocked(page, identity, {'example.com'}))
        self.assertIsNone(p.parse_blocked(f'moz-extension://{identity}/blocked.html?url={quote("https://user:pass@youtube.com/", safe="")}', identity, {'youtube.com'}))
        self.assertIsNone(p.parse_blocked('https://youtube.com/', identity, {'youtube.com'}))


class DeduplicationTests(unittest.TestCase):
    def test_repeated_tabs_count_once(self):
        rows = [{'tab_index': i, 'status': 'blocked-existing', 'original_target': 'https://www.reddit.com/'} for i in (1, 2, 3)]
        unique, count = p.deduplicate_observations(rows)
        self.assertEqual(count, 1)
        self.assertEqual(len(unique), 1)

if __name__ == '__main__':
    unittest.main()

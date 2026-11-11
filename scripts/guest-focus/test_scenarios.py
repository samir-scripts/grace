import subprocess
import unittest
from unittest.mock import Mock, patch

import scenarios


class ClassificationTests(unittest.TestCase):
    def test_work_requires_all_three_terminations_and_no_existing_process(self):
        self.assertEqual(scenarios.classify('work', False, [True, True, True]), 'pass')
        self.assertEqual(scenarios.classify('work', True, [True, True, True]), 'fail')
        self.assertEqual(scenarios.classify('work', False, [True, False, True]), 'fail')
        self.assertEqual(scenarios.classify('work', False, [True]), 'inconclusive')

    def test_other_phases_require_survival(self):
        for phase in ('baseline', 'break', 'released'):
            self.assertEqual(scenarios.classify(phase, False, [False]), 'pass')
            self.assertEqual(scenarios.classify(phase, False, [True]), 'inconclusive')

    def test_manual_native_evidence_never_becomes_automated_pass(self):
        self.assertEqual(scenarios.native_evidence_status(None), 'blocked')
        self.assertEqual(scenarios.native_evidence_status('/tmp/screenshot.png'), 'inconclusive')


class LaunchObservationTests(unittest.TestCase):
    def test_exit_observation_records_elapsed_and_code_before_cleanup(self):
        child = Mock(pid=123)
        child.wait.return_value = 7
        child.poll.return_value = 7
        with patch.object(scenarios.subprocess, 'Popen', return_value=child), \
             patch.object(scenarios.time, 'monotonic', side_effect=[10.0, 10.25]), \
             patch.object(scenarios, 'helper_pids', return_value=[456]):
            result = scenarios.observe_launch(4)
        self.assertEqual(result['elapsed_ms'], 250)
        self.assertEqual(result['exit_code'], 7)
        self.assertTrue(result['terminated'])
        self.assertEqual(result['helper_pids'], [456])
        child.terminate.assert_not_called()

    def test_survivor_records_no_exit_code_before_cleanup(self):
        child = Mock(pid=123)
        child.wait.side_effect = [subprocess.TimeoutExpired('Discord', 3), 0]
        child.poll.return_value = None
        with patch.object(scenarios.subprocess, 'Popen', return_value=child), \
             patch.object(scenarios.time, 'monotonic', side_effect=[10.0, 13.0]), \
             patch.object(scenarios, 'helper_pids', return_value=[]):
            result = scenarios.observe_launch(3)
        self.assertEqual(result['elapsed_ms'], 3000)
        self.assertIsNone(result['exit_code'])
        self.assertFalse(result['terminated'])
        child.terminate.assert_called_once()


if __name__ == '__main__':
    unittest.main()

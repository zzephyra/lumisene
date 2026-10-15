"""Deployment orchestration checks using explicit command doubles, no Docker daemon."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DeployTest(unittest.TestCase):
    def run_deploy(self, fail_pulls=False, tag='a' * 40):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            log = path / 'calls'
            docker = path / 'docker'
            docker.write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$CALL_LOG"
if [[ "$*" == *" pull" && "$FAIL_PULL" == 1 ]]; then exit 1; fi
if [[ "$1" == login ]]; then cat >/dev/null; printf '%s' "$DOCKER_CONFIG" > "$CONFIG_LOG"; fi
''')
            for name in ('curl', 'sleep'):
                (path / name).write_text('#!/bin/bash\nexit 0\n')
            for name in ('docker', 'curl', 'sleep'):
                (path / name).chmod(0o755)
            result = subprocess.run(
                ['bash', str(ROOT / 'scripts/deploy-tencent.sh'), 'ghcr.io/test/app', tag, 'test-user'],
                input='test-token', text=True, capture_output=True,
                env={**os.environ, 'PATH': f'{tmp}:{os.environ["PATH"]}',
                     'CALL_LOG': str(log), 'CONFIG_LOG': str(path / 'config'),
                     'FAIL_PULL': str(int(fail_pulls))},
            )
            calls = log.read_text() if log.exists() else ''
            if (path / 'config').exists():
                self.assertFalse(Path((path / 'config').read_text()).exists())
            self.assertNotIn('test-token', calls + result.stdout + result.stderr)
            return result, calls

    def test_success_pulls_then_migrates_then_starts_without_build(self):
        result, calls = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('--build', calls)
        self.assertIn('--no-build --pull never', calls)
        self.assertLess(calls.index(' pull'), calls.index('alembic upgrade head'))
        self.assertLess(calls.index('alembic upgrade head'), calls.index('--remove-orphans'))

    def test_failed_pull_retries_and_never_changes_services(self):
        result, calls = self.run_deploy(fail_pulls=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls.count(' pull\n'), 4)
        self.assertNotIn(' up ', calls)
        self.assertNotIn('alembic', calls)

    def test_invalid_tag_fails_before_docker(self):
        result, calls = self.run_deploy(tag='latest')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, '')


if __name__ == '__main__':
    unittest.main()

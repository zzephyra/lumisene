"""Deployment orchestration checks using explicit command doubles, no Docker daemon."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DeployTest(unittest.TestCase):
    def run_deploy(self, fail_pulls=False, tag='a' * 40, missing_env=False, fail_migration=False):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            # Run a copy of the real script in an isolated deployment root.
            (path / 'scripts').mkdir()
            shutil.copy2(ROOT / 'scripts/deploy-tencent.sh', path / 'scripts/deploy-tencent.sh')
            shutil.copy2(ROOT / 'docker-compose.deploy.yml', path / 'docker-compose.deploy.yml')
            if not missing_env:
                (path / '.env.prod').write_text('POSTGRES_PASSWORD=test-only\nMINIO_ROOT_PASSWORD=test-only\n')
            log = path / 'calls'
            docker = path / 'docker'
            docker.write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$CALL_LOG"
if [[ "$1 $2" == "image inspect" ]]; then exit 1; fi
if [[ "$1" == pull && "$FAIL_PULL" == 1 ]]; then exit 1; fi
if [[ "$*" == *"alembic upgrade head"* && "$FAIL_MIGRATION" == 1 ]]; then exit 1; fi
if [[ "$1" == login ]]; then cat >/dev/null; printf '%s' "$DOCKER_CONFIG" > "$CONFIG_LOG"; fi
''')
            for name in ('curl', 'sleep'):
                (path / name).write_text('#!/bin/bash\nexit 0\n')
            for name in ('docker', 'curl', 'sleep'):
                (path / name).chmod(0o755)
            result = subprocess.run(
                ['bash', str(path / 'scripts/deploy-tencent.sh'), 'ghcr.io/test/app', tag, 'test-user'],
                input='test-token', text=True, capture_output=True,
                env={**os.environ, 'PATH': f'{tmp}:{os.environ["PATH"]}',
                     'CALL_LOG': str(log), 'CONFIG_LOG': str(path / 'config'),
                     'FAIL_PULL': str(int(fail_pulls)), 'FAIL_MIGRATION': str(int(fail_migration))},
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
        tag = 'a' * 40
        self.assertLess(calls.index('pull '), calls.index('alembic upgrade head'))
        self.assertIn('pull mirror.ccs.tencentyun.com/library/postgres:16', calls)
        self.assertIn(f'pull ghcr.io/test/app-backend:{tag}', calls)
        self.assertIn(f'pull ghcr.io/test/app-frontend:{tag}', calls)
        self.assertLess(calls.index('alembic upgrade head'), calls.index('--remove-orphans'))

    def test_failed_pull_retries_and_never_changes_services(self):
        result, calls = self.run_deploy(fail_pulls=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum(line.startswith('pull ') for line in calls.splitlines()), 8)
        self.assertNotIn(' up ', calls)
        self.assertNotIn('alembic', calls)

    def test_invalid_tag_fails_before_docker(self):
        result, calls = self.run_deploy(tag='latest')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, '')
        self.assertIn('Invalid commit SHA', result.stderr)

    def test_missing_env_fails_before_docker(self):
        result, calls = self.run_deploy(missing_env=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing .env.prod', result.stderr)
        self.assertEqual(calls, '')

    def test_failed_migration_never_updates_application(self):
        result, calls = self.run_deploy(fail_migration=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('alembic upgrade head', calls)
        self.assertNotIn('--remove-orphans', calls)

    def test_frontend_uses_ci_image(self):
        compose = (ROOT / 'docker-compose.deploy.yml').read_text()
        frontend = compose.split('  frontend:', 1)[1].split('volumes:', 1)[0]
        self.assertIn('image: ${FRONTEND_IMAGE:', frontend)
        self.assertNotIn('build:', frontend)
        self.assertIn('127.0.0.1:5173:5173', frontend)
        self.assertIn('http://127.0.0.1:5173/', frontend)
        self.assertNotIn('alembic upgrade head &&', compose)


if __name__ == '__main__':
    unittest.main()

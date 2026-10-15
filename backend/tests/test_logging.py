import os
from datetime import UTC, datetime, timedelta

import pytest
from app.core.logging import configure_logging, get_logger, purge_expired_logs
from pydantic import ValidationError

from tests.conftest import make_settings


def test_log_retention_defaults_to_seven_days() -> None:
    settings = make_settings()
    assert settings.log_retention_days == 7
    assert settings.log_dir == "logs"


def test_log_retention_rejects_non_positive_days() -> None:
    with pytest.raises(ValidationError):
        make_settings(log_retention_days=0)


def test_log_file_keeps_recent_lines_and_drops_expired_files(tmp_path, capsys) -> None:
    expired = tmp_path / "api.log.2020-01-01"
    current = tmp_path / "api.log"
    expired.write_text("old\n", encoding="utf-8")
    current.write_text("kept\n", encoding="utf-8")
    expired_at = (datetime.now(UTC) - timedelta(days=8)).timestamp()
    os.utime(expired, (expired_at, expired_at))

    configure_logging(
        make_settings(
            environment="development",
            log_dir=str(tmp_path),
            log_retention_days=7,
            log_service="api",
        )
    )
    get_logger("test").info("chat_auto_image_failed", turn_id="turn-1")

    assert not expired.exists()
    written = current.read_text(encoding="utf-8")
    assert "kept" in written
    assert "chat_auto_image_failed" in written
    assert "turn-1" in written
    assert "chat_auto_image_failed" in capsys.readouterr().out
    configure_logging(make_settings())


def test_testing_does_not_create_log_files(tmp_path) -> None:
    configure_logging(make_settings(log_dir=str(tmp_path), log_retention_days=7, log_service="api"))
    get_logger("test").info("not_stored")
    assert list(tmp_path.iterdir()) == []


def test_purge_uses_the_configured_retention_window(tmp_path) -> None:
    service_log = tmp_path / "image-worker.log"
    other_log = tmp_path / "api.log"
    service_log.write_text("worker\n", encoding="utf-8")
    other_log.write_text("api\n", encoding="utf-8")
    old = (datetime.now(UTC) - timedelta(days=3)).timestamp()
    os.utime(service_log, (old, old))
    os.utime(other_log, (old, old))

    removed = purge_expired_logs(tmp_path, "image-worker", 2)
    assert removed == [service_log]
    assert not service_log.exists()
    assert other_log.exists()

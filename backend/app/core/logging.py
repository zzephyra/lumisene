import logging
import re
import sys
from datetime import UTC, datetime, timedelta
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

import structlog

from app.core.config import Settings

_file_handler: logging.Handler | None = None
_SERVICE_MARKERS = (
    ("image_generation", "image-worker"),
    ("video_generation", "video-worker"),
    ("text_completion", "text-worker"),
    ("editor_render", "editor-worker"),
    ("uvicorn", "api"),
    ("app.main", "api"),
)


def resolve_log_service(configured: str) -> str:
    """Use the configured process name, otherwise identify the running entrypoint."""

    if configured:
        return configured
    command = " ".join(sys.argv)
    for marker, name in _SERVICE_MARKERS:
        if marker in command:
            return name
    return "app"


def purge_expired_logs(
    directory: Path,
    service: str,
    retention_days: int,
    *,
    now: datetime | None = None,
) -> list[Path]:
    """Delete this service's log files last written before the retention window."""

    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)
    if not directory.is_dir():
        return []
    removed: list[Path] = []
    prefix = f"{service}.log"
    for path in directory.iterdir():
        if not path.is_file() or not path.name.startswith(prefix):
            continue
        modified = datetime.fromtimestamp(path.stat().st_mtime, UTC)
        if modified < cutoff:
            path.unlink()
            removed.append(path)
    return removed


class _RetentionRotatingHandler(TimedRotatingFileHandler):
    def __init__(self, filename: Path, retention_days: int) -> None:
        super().__init__(
            filename,
            when="midnight",
            interval=1,
            backupCount=retention_days,
            encoding="utf-8",
            utc=True,
            delay=True,
        )
        self.retention_days = retention_days
        self.service_name = filename.stem
        self.suffix = "%Y-%m-%d"
        self.extMatch = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        self.setFormatter(logging.Formatter("%(message)s"))

    def doRollover(self) -> None:
        super().doRollover()
        purge_expired_logs(Path(self.baseFilename).parent, self.service_name, self.retention_days)


class _Tee:
    """Write each rendered log line to the console and the retention-managed file."""

    def __init__(self, stream, handler: logging.Handler | None) -> None:
        self._stream = stream
        self._handler = handler

    def write(self, message: str) -> int:
        self._stream.write(message)
        self._stream.flush()
        if self._handler is not None and message.strip():
            self._handler.emit(
                logging.LogRecord(
                    name="fluxora",
                    level=logging.INFO,
                    pathname=__file__,
                    lineno=0,
                    msg=message.rstrip("\n"),
                    args=(),
                    exc_info=None,
                )
            )
        return len(message)

    def flush(self) -> None:
        self._stream.flush()
        if self._handler is not None:
            self._handler.flush()


def configure_logging(settings: Settings) -> None:
    global _file_handler
    if _file_handler is not None:
        _file_handler.close()
        _file_handler = None

    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    handler: logging.Handler | None = None
    if not settings.is_testing and settings.log_dir:
        directory = Path(settings.log_dir)
        directory.mkdir(parents=True, exist_ok=True)
        service = resolve_log_service(settings.log_service)
        purge_expired_logs(directory, service, settings.log_retention_days)
        handler = _RetentionRotatingHandler(
            directory / f"{service}.log",
            settings.log_retention_days,
        )
        _file_handler = handler

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=_Tee(sys.stdout, handler)),
        cache_logger_on_first_use=False,
    )


def get_logger(name: str | None = None):
    return structlog.get_logger(name)


def bind_request_context(*, request_id: str, trace_id: str) -> None:
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id, trace_id=trace_id)


def clear_request_context() -> None:
    structlog.contextvars.clear_contextvars()


def get_request_id() -> str | None:
    value = structlog.contextvars.get_contextvars().get("request_id")
    return str(value) if value else None

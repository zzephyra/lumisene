from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
INFRASTRUCTURE = APP / "infrastructure"
ADAPTERS = INFRASTRUCTURE / "ai" / "adapters"
MODULES = APP / "modules"
FORBIDDEN_IMPORTS = ("fastapi", "langchain", "celery", "openai")
ADAPTER_SDKS = {"langchain", "openai"}


def test_ports_do_not_import_frameworks_or_provider_sdks() -> None:
    offenders: list[str] = []
    for path in INFRASTRUCTURE.rglob("*.py"):
        if "db" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for name in FORBIDDEN_IMPORTS:
            if name in ADAPTER_SDKS and ADAPTERS in path.parents:
                continue
            if f"import {name}" in text or f"from {name}" in text:
                offenders.append(f"{path.name}: {name}")
    assert offenders == []


def test_domain_modules_stay_free_of_frameworks() -> None:
    forbidden = ("fastapi", "sqlalchemy", "celery", "langchain", "argon2", "redis")
    offenders: list[str] = []
    for path in MODULES.rglob("domain.py"):
        text = path.read_text(encoding="utf-8")
        for name in forbidden:
            if f"import {name}" in text or f"from {name}" in text:
                offenders.append(f"{path.relative_to(APP)}: {name}")
    assert offenders == []


def test_routers_do_not_import_sqlalchemy_or_provider_sdks() -> None:
    forbidden = ("sqlalchemy", "asyncpg", "elasticsearch", "celery", "langchain", "argon2")
    offenders: list[str] = []
    for path in MODULES.rglob("router.py"):
        text = path.read_text(encoding="utf-8")
        for name in forbidden:
            if f"import {name}" in text or f"from {name}" in text:
                offenders.append(f"{path.relative_to(APP)}: {name}")
    assert offenders == []

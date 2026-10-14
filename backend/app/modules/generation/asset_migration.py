"""Copy still-readable legacy objects to Qiniu. Unreadable files stay unmigrated."""

from sqlalchemy import select

from app.modules.generation.deletion import migration_decision
from app.modules.generation.models import Asset


async def migrate_legacy_asset(asset, source, destination) -> str:
    if asset.storage_provider == "qiniu":
        return migration_decision(provider="qiniu", readable=True)
    try:
        content = await source.get_object(object_key=asset.object_key)
    except Exception:
        return migration_decision(provider=asset.storage_provider, readable=False)
    if not content:
        return "unrecoverable"
    await destination.put_object(
        object_key=asset.object_key,
        content=content,
        content_type=asset.mime,
    )
    asset.storage_provider = "qiniu"
    asset.bucket = getattr(destination, "bucket_name", "")
    return "migrated"


async def migrate_legacy_assets(session, source, destination) -> dict[str, list[str] | int]:
    rows = (
        await session.execute(
            select(Asset).where(Asset.storage_provider != "qiniu", Asset.deleted_at.is_(None))
        )
    ).scalars().all()
    report: dict[str, list[str] | int] = {"migrated": 0, "skipped": 0, "unrecoverable": []}
    unrecoverable = report["unrecoverable"]
    assert isinstance(unrecoverable, list)
    for asset in rows:
        outcome = await migrate_legacy_asset(asset, source, destination)
        if outcome == "migrated":
            report["migrated"] = int(report["migrated"]) + 1
        elif outcome == "unrecoverable":
            unrecoverable.append(str(asset.id))
        else:
            report["skipped"] = int(report["skipped"]) + 1
    await session.commit()
    return report


def main() -> None:
    import asyncio

    from app.core.config import get_settings
    from app.infrastructure.db.session import create_db_engine, create_session_factory
    from app.infrastructure.storage.objects import QiniuObjectStorage
    from app.infrastructure.storage.s3 import S3Storage

    settings = get_settings()
    if not settings.qiniu_configured:
        raise SystemExit("七牛未配置，不能迁移作品")

    async def _run() -> None:
        engine = create_db_engine(settings)
        try:
            async with create_session_factory(engine)() as session:
                report = await migrate_legacy_assets(
                    session,
                    S3Storage(settings),
                    QiniuObjectStorage(settings),
                )
            print(report)
        finally:
            await engine.dispose()

    asyncio.run(_run())


if __name__ == "__main__":
    main()

"""Read-only generated media projection, always restricted to one project."""

from sqlalchemy import String, case, cast, literal, select

from app.modules.generation.models import Asset


def generated_media_rows(project):
    return (
        select(
            Asset.id.label("id"),
            literal("generated").label("source"),
            (literal("生成作品 · ") + cast(Asset.id, String)).label("filename"),
            case(
                (Asset.kind == "IMAGE", "image"), (Asset.kind == "VIDEO", "video"), else_="document"
            ).label("kind"),
            Asset.mime.label("mime"),
            Asset.size_bytes.label("size"),
            Asset.created_by.label("owner_id"),
            Asset.created_at.label("created_at"),
            Asset.width,
            Asset.height,
            Asset.duration_ms,
        )
        .where(
            Asset.project_id == project,
            Asset.status == "ready",
            Asset.kind.in_(["IMAGE", "VIDEO", "FILE"]),
        )
        .subquery()
    )


def generation_output_links():
    """Read-only deletion/reference projection, scoped by the consuming port."""
    from app.modules.generation.models import GenerationOutput

    return select(
        GenerationOutput.project_id, GenerationOutput.task_id, GenerationOutput.asset_id
    ).subquery()

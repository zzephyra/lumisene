"""Compose authorized read projections; no cross-module table access."""

from sqlalchemy import String, and_, case, cast, func, literal, or_, select, union_all

from app.modules.characters.library_port import character_library_rows
from app.modules.generation.library_port import generated_media_rows
from app.modules.story_assets.models import StoryAssetLink
from app.modules.storyline.library_port import scene_library_targets
from app.modules.uploads.library_port import upload_media_rows


class LibraryRepository:
    def query(self, project, story, category="all", search=""):
        link = StoryAssetLink
        scenes = scene_library_targets(project, story)
        direct = (
            select(
                case((link.upload_id.is_not(None), "upload"), else_="generated").label("source"),
                func.coalesce(link.upload_id, link.asset_id).label("media_id"),
                link.name.label("display_name"),
                link.category,
                case((link.scene_id.is_not(None), "scene"), else_="story").label("target_type"),
                func.coalesce(link.scene_id, link.story_id).label("target_id"),
                case(
                    (link.scene_id.is_not(None), func.coalesce(scenes.c.title, "场景已删除")),
                    else_="当前剧本",
                ).label("target_name"),
                literal(False).label("primary"),
                link.created_at.label("added_at"),
                cast(link.id, String).label("direct_id"),
            )
            .outerjoin(scenes, scenes.c.id == link.scene_id)
            .where(link.project_id == project, link.story_id == story)
        )
        people = character_library_rows(project, story)
        characters = select(
            people.c.source,
            people.c.media_id,
            people.c.display_name,
            people.c.category,
            literal("character").label("target_type"),
            people.c.target_id,
            people.c.target_name,
            people.c.primary,
            people.c.added_at,
            cast(literal(None), String).label("direct_id"),
        )
        refs = union_all(direct, characters).subquery()
        uploads = upload_media_rows()
        generated = generated_media_rows(project)
        media = union_all(select(uploads), select(generated)).subquery()
        display = func.coalesce(
            func.max(case((refs.c.direct_id.is_not(None), refs.c.display_name))),
            func.min(refs.c.display_name),
            media.c.filename,
        )
        references = func.jsonb_agg(
            func.jsonb_build_object(
                "type",
                refs.c.target_type,
                "id",
                refs.c.target_id,
                "name",
                refs.c.target_name,
                "primary",
                refs.c.primary,
            )
        )
        statement = (
            select(
                *media.c,
                display.label("name"),
                func.max(refs.c.added_at).label("added_at"),
                func.max(refs.c.direct_id).label("direct_link_id"),
                func.min(refs.c.category).label("category"),
                references.label("references"),
            )
            .select_from(
                media.join(
                    refs,
                    and_(media.c.id == refs.c.media_id, media.c.source == refs.c.source),
                )
            )
            .group_by(*media.c)
        )
        filters = []
        if category in {"character", "scene", "shot"}:
            filters.append(func.bool_or(refs.c.category == category))
        if category in {"video", "document"}:
            statement = statement.where(media.c.kind == category)
        if search.strip():
            escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            filters.append(
                func.bool_or(
                    or_(
                        refs.c.display_name.ilike(pattern, escape="\\"),
                        refs.c.target_name.ilike(pattern, escape="\\"),
                        media.c.filename.ilike(pattern, escape="\\"),
                    )
                )
            )
        if filters:
            statement = statement.having(and_(*filters))
        return statement.subquery()

    async def link(self, session, project, story, source, identity):
        field = StoryAssetLink.upload_id if source == "upload" else StoryAssetLink.asset_id
        return await session.scalar(
            select(StoryAssetLink)
            .where(
                StoryAssetLink.project_id == project,
                StoryAssetLink.story_id == story,
                field == identity,
            )
            .with_for_update()
        )

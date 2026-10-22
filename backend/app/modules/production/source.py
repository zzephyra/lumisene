"""Scope selection and explicit source synchronization never regenerate media."""

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime

from app.core.errors import ConflictError, ValidationError
from app.modules.production.schemas import Board, ProductionSource, SourceChapter, SourceImpact


def select_snapshot(snapshot, selections):
    result = deepcopy(snapshot)
    if selections is None:
        return result
    if not selections:
        raise ValidationError("请选择至少一个章节")
    chapters = {c["id"]: c for c in snapshot["chapters"]}
    if len({s.chapter_id for s in selections}) != len(selections):
        raise ValidationError("章节选择不能重复")
    selected = []
    for selection in selections:
        chapter = deepcopy(chapters.get(str(selection.chapter_id)))
        if chapter is None:
            raise ValidationError("所选章节不属于当前剧本或已删除")
        if selection.scene_ids is not None:
            ids = {str(i) for i in selection.scene_ids}
            available = {s["id"] for s in chapter["scenes"]}
            if not ids or not ids.issubset(available):
                raise ValidationError("所选场景不属于当前章节")
            chapter["scenes"] = [s for s in chapter["scenes"] if s["id"] in ids]
        selected.append(chapter)
    result["chapters"] = selected
    result["selection"] = [s.model_dump(mode="json") for s in selections]
    return result


def fingerprint(snapshot):
    story = snapshot["story"]
    stable = {
        "chapters": snapshot["chapters"],
        "story": {k: story.get(k) for k in ["id", "version", "title", "description"]},
    }
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()


class ProductionSources:
    def __init__(self, service):
        self.service = service

    async def source(self, uow, actor, project, story):
        snapshot = await self.service.plots.production_snapshot(uow, actor, project, story)
        context = await self.service.plots.characters.storyline_context(uow, actor, project, story)
        names = {c["id"]: c["name"] for c in context["characters"]}
        chapters = []
        for chapter in snapshot["chapters"]:
            text = "".join(
                b.get("content", "") for scene in chapter["scenes"] for b in scene["blocks"]
            )
            ids = {c for scene in chapter["scenes"] for c in scene["character_ids"]}
            chapters.append(
                SourceChapter(
                    id=chapter["id"],
                    title=chapter["title"],
                    summary=chapter.get("summary", ""),
                    version=chapter["version"],
                    scenes=[
                        {
                            k: s[k]
                            for k in [
                                "id",
                                "title",
                                "summary",
                                "version",
                                "character_ids",
                                "blocks",
                            ]
                        }
                        for s in chapter["scenes"]
                    ],
                    text_length=len(text),
                    character_names=[names[i] for i in sorted(ids) if i in names],
                )
            )
        return ProductionSource(story_id=story, title=snapshot["story"]["title"], chapters=chapters)

    async def impact(self, uow, actor, project, identity):
        row = await self.service.get(uow, actor, project, identity)
        fresh = await self.service.plots.production_snapshot(uow, actor, project, row.story_id)
        current = {c["id"]: c for c in fresh["chapters"]}
        old = {c["id"]: c for c in row.snapshot["chapters"]}
        # Compare the selected scene subset, not the full live chapter.
        selections = {
            s["chapter_id"]: s.get("scene_ids") for s in row.snapshot.get("selection", [])
        }
        compared = deepcopy(current)
        for identity, scene_ids in selections.items():
            if identity in compared and scene_ids is not None:
                compared[identity]["scenes"] = [
                    s for s in compared[identity]["scenes"] if s["id"] in scene_ids
                ]
        changed = [i for i, c in old.items() if compared.get(i) != c]
        # Unknown legacy origins are conservatively included; unrelated mapped shots stay untouched.
        affected = [
            s.id
            for scene in Board.model_validate(row.board).scenes
            for s in scene.shots
            if changed and (not s.source_chapter_id or str(s.source_chapter_id) in changed)
        ]
        return SourceImpact(
            fingerprint=fingerprint(fresh),
            changed_chapter_ids=changed,
            removed_chapter_ids=[i for i in old if i not in current],
            affected_shot_ids=affected,
            has_changes=bool(changed)
            or row.snapshot["story"]["version"] != fresh["story"]["version"],
        )

    async def sync(self, uow, actor, project, identity, payload):
        row = await self.service.get(uow, actor, project, identity, lock=True)
        self.service.version(row, payload.expected_version)
        await self.service.require_editable(uow, row)
        fresh = await self.service.plots.production_snapshot(uow, actor, project, row.story_id)
        if fingerprint(fresh) != payload.fingerprint:
            raise ConflictError("剧本再次发生变化，请重新查看差异")
        from app.modules.production.schemas import ChapterSelection

        selections = payload.selections
        if selections is None:
            selections = [
                ChapterSelection.model_validate(s)
                for s in row.snapshot.get(
                    "selection", [{"chapter_id": c["id"]} for c in row.snapshot["chapters"]]
                )
            ]
        fresh = select_snapshot(fresh, selections)
        fresh["cast"] = await self.service.plots.characters.storyline_context(
            uow, actor, project, row.story_id
        )
        # Preserve the last source for checking manually retained shots after scope changes.
        fresh["previous_source"] = {k: row.snapshot[k] for k in ("story", "chapters")}
        valid_scenes = {s["id"] for c in fresh["chapters"] for s in c["scenes"]}
        row.settings = {
            **row.settings,
            "scene_references": {
                k: v
                for k, v in row.settings.get("scene_references", {}).items()
                if k in valid_scenes
            },
        }
        row.snapshot = fresh
        row.updated_at = datetime.now(UTC)
        row.version += 1
        await uow.commit()
        return await self.service.view(uow, actor, project, identity)

"""Project-scoped production orchestration; media/text state stays in its owner module."""

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import delete, select

from app.core.errors import ConflictError, NotFoundError, ValidationError, VersionConflictError
from app.modules.characters.images import CharacterImagesService
from app.modules.production.models import Production, ProductionAsset, ProductionRun
from app.modules.production.readiness import readiness
from app.modules.production.schemas import Board, ProductionView, RunView
from app.modules.production.source import select_snapshot
from app.modules.story_assets.service import StoryAssetService


class ProductionService:
    def __init__(self, plots, images, videos, completions, editor):
        self.plots, self.images, self.videos = plots, images, videos
        self.completions, self.editor = completions, editor
        self.resources = StoryAssetService(
            plots.stories, plots.characters, plots, images, images.settings
        )

    async def get(self, uow, actor, project, identity, *, lock=False):
        await self.plots.stories.projects.authorize_content_write(uow, actor, project)
        query = select(Production).where(
            Production.project_id == project, Production.id == identity
        )
        row = await uow.session.scalar(query.with_for_update() if lock else query)
        if not row:
            raise NotFoundError("制作任务不存在")
        return row

    async def list(self, uow, actor, project):
        await self.plots.stories.projects.get_project(uow, actor, project)
        return list(
            await uow.session.scalars(
                select(Production)
                .where(Production.project_id == project)
                .order_by(Production.updated_at.desc())
                .limit(100)
            )
        )

    async def create(self, uow, actor, project, payload):
        await self.plots.stories.projects.authorize_content_write(uow, actor, project)
        snapshot = await self.plots.production_snapshot(uow, actor, project, payload.story_id)
        snapshot = select_snapshot(snapshot, payload.selections)
        snapshot["cast"] = await self.plots.characters.storyline_context(
            uow, actor, project, payload.story_id
        )
        row = Production(
            project_id=project,
            story_id=payload.story_id,
            created_by=actor,
            title=payload.title.strip(),
            snapshot=snapshot,
            settings=payload.settings.model_dump(mode="json"),
            board=Board().model_dump(mode="json"),
            version=1,
        )
        if not row.title:
            raise ValidationError("名称不能为空")
        await self.validate_settings(uow, actor, row, payload.settings)
        uow.session.add(row)
        await uow.commit()
        return await self.view(uow, actor, project, row.id)

    async def copy_settings(self, uow, actor, project, identity):
        """Copy a frozen source and settings into an independent draft, never jobs or outputs."""
        original = await self.get(uow, actor, project, identity)
        row = Production(
            project_id=project,
            story_id=original.story_id,
            created_by=actor,
            title=(original.title[:115] + " · 副本"),
            snapshot=deepcopy(original.snapshot),
            settings={**deepcopy(original.settings), "wizard_step": 0},
            board=Board().model_dump(mode="json"),
            version=1,
        )
        uow.session.add(row)
        await uow.commit()
        return await self.view(uow, actor, project, row.id)

    @staticmethod
    def version(row, expected):
        if row.version != expected:
            raise VersionConflictError("分镜已被更新，请保留本地草稿后重新载入")

    @staticmethod
    def shot(row, identity):
        board = Board.model_validate(row.board)
        for scene in board.scenes:
            for shot in scene.shots:
                if shot.id == identity:
                    return board, scene, shot
        raise NotFoundError("镜头不存在")

    async def validate(self, uow, actor, row, board):
        graph = await self.plots.characters.graph(uow, actor, row.project_id, row.story_id)
        allowed = {c.id for c in graph.characters}
        chapters = {c["id"]: c for c in row.snapshot["chapters"]}
        source_scenes = {s["id"]: c["id"] for c in chapters.values() for s in c["scenes"]}
        old_board = Board.model_validate(row.board)
        old_scenes = {s.id: s for s in old_board.scenes}
        old_shots = {s.id: s for c in old_board.scenes for s in c.shots}
        for scene in board.scenes:
            prior_scene = old_scenes.get(scene.id)
            if any(str(i) not in chapters for i in scene.source_chapter_ids) and not (
                prior_scene and prior_scene.source_chapter_ids == scene.source_chapter_ids
            ):
                raise ValidationError("场景来源超出制作范围")
            for shot in scene.shots:
                prior = old_shots.get(shot.id)
                retained_origin = prior and (prior.source_chapter_id, prior.source_scene_id) == (
                    shot.source_chapter_id,
                    shot.source_scene_id,
                )
                if (
                    shot.source_chapter_id
                    and str(shot.source_chapter_id) not in chapters
                    and not retained_origin
                ):
                    raise ValidationError("镜头来源章节超出制作范围")
                if (
                    shot.source_scene_id
                    and source_scenes.get(str(shot.source_scene_id)) != str(shot.source_chapter_id)
                    and not retained_origin
                ):
                    raise ValidationError("镜头来源场景与章节不匹配")

        for scene in board.scenes:
            if not set(scene.character_ids).issubset(allowed):
                raise ValidationError("场景人物不属于当前剧本")
            for shot in scene.shots:
                if shot.reference_upload_id:
                    view = await self.resources.detail(
                        uow, actor, row.project_id, row.story_id, "upload", shot.reference_upload_id
                    )
                    if view.kind != "image":
                        raise ValidationError("环境参考必须为故事中的图片")
                if not set(shot.character_ids).issubset(allowed):
                    raise ValidationError("镜头人物不属于当前剧本")
                if shot.character_image_id:
                    service = CharacterImagesService(self.plots.characters, self.images)
                    images = await service.view(
                        uow, actor, row.project_id, row.story_id, shot.reference_character_id
                    )
                    if shot.character_image_id not in {i.id for i in images.images}:
                        raise ValidationError("参考形象不属于选定人物")
                for asset_id, kind in [
                    (shot.reference_asset_id, "IMAGE"),
                    (shot.selected_image_id, "IMAGE"),
                    (shot.selected_video_id, "VIDEO"),
                ]:
                    if asset_id:
                        asset = await self.images.lock_asset_for_reference(
                            uow, project_id=row.project_id, asset_id=asset_id
                        )
                        if asset.kind != kind:
                            raise ValidationError("素材类型不匹配")
                for selected, kind in [
                    (shot.selected_image_id, "image"),
                    (shot.selected_video_id, "video"),
                ]:
                    if selected:
                        runs = await self.runs(uow, row)
                        valid = False
                        for run in runs:
                            if run.shot_id == shot.id and run.kind == kind:
                                state = await self.run_view(uow, actor, row, run)
                                valid |= selected in state.output_asset_ids
                        if not valid:
                            raise ValidationError("采用版本必须来自当前镜头的成功生成")

    async def save(self, uow, actor, project, identity, payload, *, executing=False):
        row = await self.get(uow, actor, project, identity, lock=True)
        self.version(row, payload.expected_version)
        if not executing:
            await self.require_editable(uow, row)
        await self.validate(uow, actor, row, payload.board)
        # Editing a confirmed shot requires explicit reconfirmation, handled by UI and API.
        old = {
            str(s.id): s.model_dump(mode="json")
            for sc in Board.model_validate(row.board).scenes
            for s in sc.shots
        }
        for scene in payload.board.scenes:
            for shot in scene.shots:
                before = old.get(str(shot.id))
                if before and before["confirmed"] and shot.confirmed:
                    ignore = {"confirmed", "selected_image_id", "selected_video_id"}
                    now = shot.model_dump(mode="json")
                    if any(now[k] != before[k] for k in now if k not in ignore):
                        raise ValidationError("修改已确认镜头前请先取消确认，保存后重新确认")
        row.board = payload.board.model_dump(mode="json")
        row.version += 1
        row.updated_at = datetime.now(UTC)
        await self.retain_assets(uow, row, payload.board)
        await uow.commit()
        return await self.view(uow, actor, project, identity)

    async def retain_assets(self, uow, row, board):
        # Retain generation-history outputs as well as adopted references.
        ids = {
            i
            for sc in board.scenes
            for s in sc.shots
            for i in (s.reference_asset_id, s.selected_image_id, s.selected_video_id)
            if i
        }
        for run in await self.runs(uow, row):
            if run.task_id:
                ids.update(
                    (
                        await self.images.output_ids(
                            uow, project_id=row.project_id, task_ids=[run.task_id]
                        )
                    )[run.task_id]
                )
        await uow.session.execute(
            delete(ProductionAsset).where(
                ProductionAsset.production_id == row.id,
                ProductionAsset.project_id == row.project_id,
            )
        )
        for identity in sorted(ids, key=str):
            await self.images.lock_asset_for_reference(
                uow, project_id=row.project_id, asset_id=identity
            )
            uow.session.add(
                ProductionAsset(project_id=row.project_id, production_id=row.id, asset_id=identity)
            )
        await uow.session.flush()

    async def runs(self, uow, row):
        return list(
            await uow.session.scalars(
                select(ProductionRun)
                .where(
                    ProductionRun.project_id == row.project_id,
                    ProductionRun.production_id == row.id,
                )
                .order_by(ProductionRun.created_at.desc())
                .limit(500)
            )
        )

    async def run_view(self, uow, actor, row, run):
        state, error, outputs = run.status, run.error, []
        if run.task_id:
            task = await self.images.get(uow, project_id=row.project_id, task_id=run.task_id)
            state, error = task.status, task.error_message
            if state == "succeeded":
                outputs = (
                    await self.images.output_ids(uow, project_id=row.project_id, task_ids=[task.id])
                )[task.id]
        if run.render_id:
            task = await self.editor.task(uow, row.project_id, actor, run.render_id)
            state, error = task.status, task.error
            if state == "succeeded" and task.output_asset_id:
                outputs = [task.output_asset_id]
        return RunView(
            id=run.id,
            shot_id=run.shot_id,
            kind=run.kind,
            status=state,
            error=error,
            output_asset_ids=outputs,
            result=run.result,
            applied=run.applied,
            created_at=run.created_at,
            prompt=run.request.get("prompt", ""),
            editor_document_id=run.editor_document_id,
        )

    async def view(self, uow, actor, project, identity):
        row = await self.get(uow, actor, project, identity)
        return ProductionView(
            id=row.id,
            story_id=row.story_id,
            title=row.title,
            version=row.version,
            updated_at=row.updated_at,
            readiness=readiness(Board.model_validate(row.board)),
            settings=row.settings,
            snapshot=row.snapshot,
            board=row.board,
            runs=[await self.run_view(uow, actor, row, r) for r in await self.runs(uow, row)],
        )

    async def replay(self, uow, row, actor, key, request):
        if not key or len(key) > 120 or not key.isascii():
            raise ValidationError("需要有效的幂等键")
        digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        old = await uow.session.scalar(
            select(ProductionRun).where(
                ProductionRun.project_id == row.project_id,
                ProductionRun.production_id == row.id,
                ProductionRun.actor_id == actor,
                ProductionRun.idempotency_key == key,
            )
        )
        if old and old.request_hash != digest:
            raise ConflictError("此幂等键已用于其他请求")
        return old, digest

    async def save_settings(self, uow, actor, project, identity, payload):
        row = await self.get(uow, actor, project, identity, lock=True)
        self.version(row, payload.expected_version)
        await self.require_editable(uow, row)
        await self.validate_settings(uow, actor, row, payload.settings)
        row.settings = payload.settings.model_dump(mode="json")
        row.version += 1
        row.updated_at = datetime.now(UTC)
        await uow.commit()
        return await self.view(uow, actor, project, identity)

    async def require_editable(self, uow, row):
        if any(
            r.kind == "execution" and r.status in {"queued", "running"}
            for r in await self.runs(uow, row)
        ):
            raise ConflictError("制作正在执行，请等待完成后再修改输入")

    async def validate_settings(self, uow, actor, row, settings):
        characters = await self.plots.characters.graph(uow, actor, row.project_id, row.story_id)
        allowed = {c.id for c in characters.characters}
        images = CharacterImagesService(self.plots.characters, self.images)
        for character, image in settings.character_references.items():
            if character not in allowed:
                raise ValidationError("人物不属于当前故事")
            if image:
                view = await images.view(uow, actor, row.project_id, row.story_id, character)
                if image not in {i.id for i in view.images}:
                    raise ValidationError("形象不属于所选人物")
        scenes = {s["id"] for c in row.snapshot["chapters"] for s in c["scenes"]}
        for scene, refs in settings.scene_references.items():
            if str(scene) not in scenes:
                raise ValidationError("场景超出本次制作范围")
            if len(refs) > 8:
                raise ValidationError("每个场景最多保存8张候选参考")
            for ref in refs:
                view = await self.resources.detail(
                    uow, actor, row.project_id, row.story_id, ref.source, ref.id
                )
                if view.kind != "image":
                    raise ValidationError("环境参考必须为故事图片")

    async def list_story(self, uow, actor, project, story):
        await self.plots.stories.get(uow, actor, project, story)
        rows = list(
            await uow.session.scalars(
                select(Production)
                .where(Production.project_id == project, Production.story_id == story)
                .order_by(Production.updated_at.desc())
                .limit(100)
            )
        )
        return [await self.view(uow, actor, project, r.id) for r in rows]

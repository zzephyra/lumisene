"""Checkpointed analysis: short DB transactions surround external IO; review is explicit."""

import asyncio
import base64
import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.infrastructure.ai.catalog import require_assigned
from app.infrastructure.ai.models import ModelConfig
from app.infrastructure.db.session import UnitOfWork
from app.infrastructure.parsing.parser import parse_document, split_text
from app.infrastructure.storage.objects import build_object_storage
from app.modules.characters.analysis_contract import Extraction
from app.modules.characters.models import (
    AnalysisJob,
    Character,
    CharacterRelationship,
    ExtractionEvidence,
    ScriptDocument,
    ScriptSegment,
)

logger = get_logger(__name__)


class AnalysisService:
    def __init__(self, settings, projects, factory=None, client=None, storage=None, stories=None):
        self.settings, self.projects, self.factory, self.client = (
            settings,
            projects,
            factory,
            client,
        )
        self.stories = stories
        self.storage = storage or build_object_storage(settings)

    async def upload(self, uow, actor, project, story, payload):
        await self.projects.authorize_content_write(uow, actor, project)
        await self.stories.get(uow, actor, project, story)
        try:
            content = base64.b64decode(payload.content_base64, validate=True)
        except ValueError as exc:
            raise ValidationError("文件编码无效") from exc
        if not content or len(content) > 5 * 1024 * 1024:
            raise ValidationError("文件不能为空或超过 5 MB")
        from app.infrastructure.parsing.documents import resolve_document_format

        resolve_document_format(filename=payload.filename)
        checksum = hashlib.sha256(content).hexdigest()
        row = await uow.session.scalar(
            select(ScriptDocument)
            .where(
                ScriptDocument.project_id == project,
                ScriptDocument.story_id == story,
                ScriptDocument.checksum == checksum,
            )
            .with_for_update()
        )
        if row and row.parse_status not in {"upload_failed", "pending"}:
            return row
        if row is None:
            identity = uuid4()
            row = ScriptDocument(
                id=identity,
                project_id=project,
                story_id=story,
                filename=payload.filename,
                checksum=checksum,
                object_key=f"projects/{project}/scripts/{identity}/source",
                parse_status="pending",
            )
            uow.session.add(row)
        await uow.commit()
        try:
            await self.storage.put_object(
                object_key=row.object_key, content=content, content_type="application/octet-stream"
            )
        except Exception:
            row.parse_status = "upload_failed"
            await uow.commit()
            raise
        await self.projects.authorize_content_write(uow, actor, project)
        row.parse_status = "uploaded"
        await uow.commit()
        return row

    async def list_jobs(self, uow, actor, project, story):
        await self.stories.get(uow, actor, project, story)
        return list(
            await uow.session.scalars(
                select(AnalysisJob)
                .where(AnalysisJob.project_id == project, AnalysisJob.story_id == story)
                .order_by(AnalysisJob.created_at.desc())
                .limit(20)
            )
        )

    async def evidence(self, uow, actor, project, story, identity):
        await self.stories.get(uow, actor, project, story)
        row = await uow.session.scalar(
            select(ExtractionEvidence).where(
                ExtractionEvidence.id == identity, ExtractionEvidence.project_id == project
            )
        )
        if row is None:
            raise NotFoundError("证据不存在")
        segment = await uow.session.get(ScriptSegment, row.segment_id)
        document = await uow.session.get(ScriptDocument, segment.document_id)
        if document is None or document.story_id != story:
            raise NotFoundError("证据不存在")
        return dict(
            id=row.id,
            segment_id=row.segment_id,
            quote=row.quote,
            source_type=row.source_type,
            confidence=row.confidence,
            start_offset=segment.start_offset + row.start_offset,
            end_offset=segment.start_offset + row.end_offset,
            sequence=segment.sequence,
        )

    async def submit(self, uow, actor, project, story, document, key):
        await self.projects.authorize_content_write(uow, actor, project)
        await self.stories.get(uow, actor, project, story)
        previous = await uow.session.scalar(
            select(AnalysisJob).where(
                AnalysisJob.project_id == project,
                AnalysisJob.story_id == story,
                AnalysisJob.actor_id == actor,
                AnalysisJob.idempotency_key == key,
            )
        )
        if previous:
            if previous.document_id != document:
                raise ConflictError("幂等键已用于另一份文档")
            return previous
        source = await uow.session.scalar(
            select(ScriptDocument).where(
                ScriptDocument.id == document, ScriptDocument.project_id == project
            )
        )
        if source is None or source.story_id != story:
            raise NotFoundError("剧本文档不存在")
        if source.parse_status not in {"uploaded", "parsed"}:
            raise ValidationError("请先完成上传")
        config = await require_assigned(uow.session, "text_generation")
        if not self.settings.model_endpoint(config.secret_ref):
            raise ValidationError("文本模型凭据未配置")
        row = AnalysisJob(
            project_id=project,
            story_id=story,
            actor_id=actor,
            document_id=document,
            idempotency_key=key,
            model_config_id=config.id,
            status="queued",
        )
        uow.session.add(row)
        await uow.session.flush()
        await uow.commit()
        return row

    async def get(self, uow, actor, project, story, identity):
        await self.stories.get(uow, actor, project, story)
        row = await uow.session.scalar(
            select(AnalysisJob)
            .where(
                AnalysisJob.id == identity,
                AnalysisJob.project_id == project,
                AnalysisJob.story_id == story,
            )
            .with_for_update()
        )
        if row is None:
            raise NotFoundError("分析任务不存在")
        return row

    async def command(self, uow, actor, project, story, identity, action):
        await self.projects.authorize_content_write(uow, actor, project)
        row = await self.get(uow, actor, project, story, identity)
        if action == "cancel" and row.status in {"queued", "running"}:
            row.status = "canceled"
            row.execution_token = None
        if action == "retry":
            if row.status not in {"failed", "canceled"}:
                raise ConflictError("当前状态不可重试")
            row.status = "queued"
            row.error_message = None
            row.execution_token = None
        if action == "accept":
            if row.status != "succeeded":
                raise ConflictError("分析尚未完成")
            if row.reviewed:
                return row
            result = Extraction.model_validate(row.result)
            identities = {}
            for candidate in result.characters:
                evidence_ids = await self._evidence(uow, project, candidate.evidence)
                c = Character(
                    project_id=project,
                    story_id=row.story_id,
                    name=candidate.name,
                    title=candidate.title,
                    role_type=candidate.role_type,
                    age=candidate.age,
                    gender=candidate.gender,
                    occupation=candidate.occupation,
                    aliases=candidate.aliases,
                    profile_data={
                        "schema_version": 1,
                        "personality": {
                            "核心性格": {
                                "value": candidate.personality,
                                "source_type": "inferred",
                                "evidence_refs": [str(e) for e in evidence_ids],
                                "confidence": min(e.confidence for e in candidate.evidence),
                                "review_status": "confirmed",
                            }
                        },
                    },
                    version=1,
                )
                for group in ["appearance", "background", "motivation"]:
                    value = getattr(candidate, group)
                    if value:
                        c.profile_data[group] = {
                            "概述": dict(
                                value=value,
                                source_type="inferred",
                                review_status="confirmed",
                                evidence_refs=[str(e) for e in evidence_ids],
                                confidence=None,
                            )
                        }
                uow.session.add(c)
                await uow.session.flush()
                identities[candidate.key] = c.id
            for candidate in result.relationships:
                refs = await self._evidence(uow, project, candidate.evidence)
                uow.session.add(
                    CharacterRelationship(
                        project_id=project,
                        story_id=row.story_id,
                        source_character_id=identities[candidate.source],
                        target_character_id=identities[candidate.target],
                        relationship_type=candidate.relationship_type,
                        direction=candidate.direction,
                        description=candidate.description,
                        evidence_refs=[str(e) for e in refs],
                        version=1,
                    )
                )
            row.reviewed = True
        await uow.commit()
        return row

    async def _evidence(self, uow, project, evidences):
        ids = []
        for e in evidences:
            segment = await uow.session.scalar(
                select(ScriptSegment).where(
                    ScriptSegment.id == e.segment_id, ScriptSegment.project_id == project
                )
            )
            if segment is None or e.quote not in segment.text:
                raise ValidationError("证据无法对应原文")
            start = segment.text.index(e.quote)
            row = ExtractionEvidence(
                project_id=project,
                segment_id=e.segment_id,
                start_offset=start,
                end_offset=start + len(e.quote),
                quote=e.quote,
                source_type=e.source_type,
                confidence=e.confidence,
            )
            uow.session.add(row)
            await uow.session.flush()
            ids.append(row.id)
        return ids

    async def queued_ids(self):
        async with self.factory() as session:
            # Interrupted calls become explicit retryable failures, not silent paid retries.
            stale = list(
                await session.scalars(
                    select(AnalysisJob)
                    .where(
                        AnalysisJob.status == "running",
                        AnalysisJob.updated_at < datetime.now(UTC) - timedelta(minutes=10),
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            for row in stale:
                row.status = "failed"
                row.error_message = "分析进程中断，可从已保存片段重试"
            await session.commit()
            return list(
                await session.scalars(
                    select(AnalysisJob.id)
                    .where(AnalysisJob.status == "queued")
                    .order_by(AnalysisJob.created_at)
                    .limit(1)
                )
            )

    async def execute(self, identity):
        async with self.factory() as session:
            row = await session.scalar(
                select(AnalysisJob).where(AnalysisJob.id == identity).with_for_update()
            )
            if row is None or row.status != "queued":
                return
            try:
                await self.projects.authorize_content_write(
                    UnitOfWork(session), row.actor_id, row.project_id
                )
            except Exception:
                row.status = "failed"
                row.error_message = "项目访问权限已失效"
                await session.commit()
                return
            token = uuid4()
            row.execution_token = token
            row.status = "running"
            row.updated_at = datetime.now(UTC)
            project, actor, document, config_id, checkpoint = (
                row.project_id,
                row.actor_id,
                row.document_id,
                row.model_config_id,
                dict(row.checkpoint),
            )
            await session.commit()
        try:
            async with self.factory() as session:
                source = await session.get(ScriptDocument, document)
                config = await session.get(ModelConfig, config_id)
                if config is None or not config.enabled:
                    raise ValidationError("文本模型已停用")
                endpoint = self.settings.model_endpoint(config.secret_ref)
                model = config.model_name
                filename, key = source.filename, source.object_key
                segments = list(
                    await session.scalars(
                        select(ScriptSegment)
                        .where(ScriptSegment.document_id == document)
                        .order_by(ScriptSegment.sequence)
                    )
                )
            if not endpoint:
                raise ValidationError("文本模型凭据未配置")
            if not segments:
                raw = await self.storage.get_object(object_key=key)
                text = await asyncio.to_thread(parse_document, filename, raw)
                async with self.factory() as session:
                    job = await session.scalar(
                        select(AnalysisJob).where(AnalysisJob.id == identity).with_for_update()
                    )
                    if job.status != "running" or job.execution_token != token:
                        return
                    for i, (start, _end, body) in enumerate(split_text(text)):
                        segment = ScriptSegment(
                            project_id=project,
                            document_id=document,
                            sequence=i,
                            start_offset=start,
                            text=body,
                        )
                        session.add(segment)
                        segments.append(segment)
                    (await session.get(ScriptDocument, document)).parse_status = "parsed"
                    await session.commit()
            for i, segment in enumerate(segments):
                if str(segment.id) in checkpoint:
                    continue
                if not await self._checkpoint(
                    identity,
                    actor,
                    project,
                    token,
                    checkpoint,
                    "extracting",
                    int(i / len(segments) * 75),
                ):
                    return
                result = await self.client.extract(
                    endpoint=endpoint,
                    model=model,
                    segments=[{"segment_id": str(segment.id), "text": segment.text}],
                )
                self._validate(result, {segment.id: segment.text})
                checkpoint[str(segment.id)] = result.model_dump(mode="json")
                if not await self._checkpoint(
                    identity,
                    actor,
                    project,
                    token,
                    checkpoint,
                    "extracting",
                    int((i + 1) / len(segments) * 75),
                ):
                    return
            if not await self._checkpoint(
                identity, actor, project, token, checkpoint, "resolving", 80
            ):
                return
            # Global identity resolution uses bounded extracted evidence, not the entire script.
            import json

            if len(json.dumps(checkpoint, ensure_ascii=False)) > 120000:
                raise ValidationError("分析候选数据超限，请拆分剧本")
            result = await self.client.extract(
                endpoint=endpoint,
                model=model,
                segments=list(checkpoint.values()),
                stage=(
                    "resolve aliases, merge cross-chapter evidence, retain ambiguity and timeline"
                ),
            )
            self._validate(result, {s.id: s.text for s in segments})
            async with self.factory() as session:
                await self.projects.authorize_content_write(UnitOfWork(session), actor, project)
                row = await session.scalar(
                    select(AnalysisJob).where(AnalysisJob.id == identity).with_for_update()
                )
                if row.status != "running" or row.execution_token != token:
                    return
                row.result = result.model_dump(mode="json")
                row.status = "succeeded"
                row.progress = 100
                row.current_stage = "review"
                await session.commit()
        except Exception as exc:
            logger.info(
                "character_analysis_failed", job_id=str(identity), error_type=type(exc).__name__
            )
            async with self.factory() as session:
                row = await session.scalar(
                    select(AnalysisJob).where(AnalysisJob.id == identity).with_for_update()
                )
                if row.status == "running" and row.execution_token == token:
                    row.status = "failed"
                    row.error_message = "分析失败，请检查文件或模型配置后重试；成功片段已保留"
                    await session.commit()

    async def _checkpoint(self, identity, actor, project, token, checkpoint, stage, progress):
        async with self.factory() as session:
            await self.projects.authorize_content_write(UnitOfWork(session), actor, project)
            row = await session.scalar(
                select(AnalysisJob).where(AnalysisJob.id == identity).with_for_update()
            )
            if row.status != "running" or row.execution_token != token:
                return False
            row.checkpoint = dict(checkpoint)
            row.current_stage = stage
            row.progress = progress
            row.updated_at = datetime.now(UTC)
            await session.commit()
            return True

    @staticmethod
    def _validate(result, segments):
        for item in [*result.characters, *result.relationships]:
            for evidence in item.evidence:
                if (
                    evidence.segment_id not in segments
                    or evidence.quote not in segments[evidence.segment_id]
                ):
                    raise ValidationError("模型证据无法对应原文")

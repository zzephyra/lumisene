"""Read-only ownership ports protect inputs and uncollected generation outputs."""

from sqlalchemy import exists, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH

from app.modules.generation.library_port import generation_output_links
from app.modules.production.models import Production, ProductionAsset, ProductionRun


def _settings_reference(source, identity):
    return func.jsonb_path_exists(
        Production.settings,
        literal(
            f'$.scene_references.*[*] ? (@.source == "{source}" && @.id == $id)', type_=JSONPATH
        ),
        func.jsonb_build_object("id", str(identity)),
    )


async def production_asset_references(session, project_id, asset_id):
    outputs = generation_output_links()
    direct = exists().where(
        ProductionAsset.project_id == project_id, ProductionAsset.asset_id == asset_id
    )
    history = exists().where(
        ProductionRun.project_id == project_id,
        ProductionRun.task_id == outputs.c.task_id,
        outputs.c.project_id == project_id,
        outputs.c.asset_id == asset_id,
    )
    settings_ref = exists().where(
        Production.project_id == project_id, _settings_reference("generated", asset_id)
    )
    return bool(await session.scalar(select(or_(direct, history, settings_ref))))


async def production_upload_references(session, upload_id):
    board_ref = func.jsonb_path_exists(
        Production.board,
        literal("$.scenes[*].shots[*] ? (@.reference_upload_id == $id)", type_=JSONPATH),
        func.jsonb_build_object("id", str(upload_id)),
    )
    return bool(
        await session.scalar(
            select(exists().where(or_(board_ref, _settings_reference("upload", upload_id))))
        )
    )

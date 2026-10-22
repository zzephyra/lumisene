"""Claim queued text completions and call the model gateway outside the API process."""

import asyncio

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.infrastructure.ai.adapters.character_analysis import CharacterAnalysisClient
from app.infrastructure.ai.adapters.langchain_chat import LangChainCreativeChat
from app.infrastructure.ai.text_completion import TextCompletionService
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.auth.service import AuthService
from app.modules.characters.analysis import AnalysisService
from app.modules.characters.service import CharacterService
from app.modules.chat.service import ChatService
from app.modules.editor.service import EditorService
from app.modules.generation.service import ImageGenerationService
from app.modules.generation.video import VideoGenerationService
from app.modules.production.execution import ProductionExecution
from app.modules.production.planning import ProductionPlanning
from app.modules.production.service import ProductionService
from app.modules.projects.service import ProjectService
from app.modules.stories.service import StoryService
from app.modules.storyline.ai import PlotAIService
from app.modules.storyline.service import StorylineService
from app.modules.uploads.service import UploadService

logger = get_logger(__name__)


async def _run() -> None:
    settings = get_settings()
    configure_logging(settings)
    engine = create_db_engine(settings)
    session_factory = create_session_factory(engine)
    service = TextCompletionService(settings, session_factory=session_factory)
    projects = ProjectService(AuthService(settings))
    chat = ChatService(settings, projects, session_factory, LangChainCreativeChat())
    analysis = AnalysisService(settings, projects, session_factory, CharacterAnalysisClient())

    stories = StoryService(projects, UploadService(settings))
    plot_ai = PlotAIService(StorylineService(stories, CharacterService(projects, stories)), service)

    productions = ProductionPlanning(
        ProductionService(
            plot_ai.plots,
            ImageGenerationService(settings),
            VideoGenerationService(settings),
            service,
            EditorService(settings),
        )
    )

    async def collect_plots():
        while True:
            try:
                for name, collector in (
                    ("plot", plot_ai),
                    ("production_plan", productions),
                    ("production_execution", ProductionExecution(productions.productions)),
                ):
                    try:
                        await collector.collect(session_factory)
                    except Exception:
                        logger.exception("collection_failed", collector=name)
            except Exception:
                logger.exception("plot_collection_failed")
            await asyncio.sleep(1)

    plot_task = asyncio.create_task(collect_plots())

    async def analyze_scripts():
        while True:
            for analysis_id in await analysis.queued_ids():
                await analysis.execute(analysis_id)
            await asyncio.sleep(1)

    analysis_task = asyncio.create_task(analyze_scripts())
    logger.info("text_completion_worker_started")
    try:
        while True:
            if plot_task.done():
                plot_task.result()
            if analysis_task.done():
                analysis_task.result()
            completion_ids = await service.queued_ids()
            for turn_id in await chat.queued_ids():
                await chat.execute(turn_id)
            if not completion_ids:
                await asyncio.sleep(1)
                continue
            for completion_id in completion_ids:
                await service.execute(completion_id)
    finally:
        plot_task.cancel()
        await asyncio.gather(plot_task, return_exceptions=True)
        analysis_task.cancel()
        await asyncio.gather(analysis_task, return_exceptions=True)
        await engine.dispose()
        logger.info("text_completion_worker_stopped")


def main() -> None:
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()

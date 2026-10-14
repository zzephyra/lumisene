from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.public_works import router as public_works_router
from app.api.skills import router as skills_router
from app.api.system_settings import router as system_settings_router
from app.api.admin_media import router as admin_media_router
from app.api.admin_operations import router as admin_operations_router
from app.api.exception_handlers import register_exception_handlers
from app.api.generation import router as generation_router
from app.api.health import router as health_router
from app.api.middleware import RequestContextMiddleware
from app.api.model_configs import router as model_configs_router
from app.api.text_completions import router as text_completions_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging, get_logger
from app.infrastructure.db.session import create_db_engine, create_session_factory
from app.modules.auth.router import router as auth_router
from app.modules.editor.router import router as editor_router
from app.modules.projects.router import router as projects_router
from app.modules.uploads.router import router as uploads_router

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = create_db_engine(resolved_settings)
        app.state.settings = resolved_settings
        app.state.engine = engine
        app.state.session_factory = create_session_factory(engine)
        from app.modules.settings.service import SettingsService

        async with app.state.session_factory() as session:
            await SettingsService(resolved_settings).initialize(session)
        logger.info("application_started", environment=resolved_settings.environment)
        try:
            yield
        finally:
            await engine.dispose()
            logger.info("application_stopped")

    app = FastAPI(title="Lumi", description="AI image and video creative workspace by Lumisene", lifespan=lifespan)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "X-CSRF-Token",
            "X-Request-ID",
            "X-Trace-ID",
            "Idempotency-Key",
        ],
    )
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(admin_operations_router)
    app.include_router(admin_media_router)
    app.include_router(skills_router)
    app.include_router(system_settings_router)
    app.include_router(auth_router)
    app.include_router(projects_router)
    app.include_router(model_configs_router)
    app.include_router(text_completions_router)
    app.include_router(generation_router)
    app.include_router(public_works_router)
    app.include_router(editor_router)
    app.include_router(uploads_router)
    return app


app = create_app()

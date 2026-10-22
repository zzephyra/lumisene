"""Application error types.

These types intentionally do not import FastAPI. HTTP translation lives in the API layer.
"""

from typing import Any


class ApplicationError(Exception):
    """Base error converted by the API exception handler."""

    status_code = 400
    code = "application_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class DomainError(ApplicationError):
    status_code = 422
    code = "domain_error"


class ValidationError(ApplicationError):
    status_code = 422
    code = "validation_error"


class AuthenticationError(ApplicationError):
    status_code = 401
    code = "authentication_error"


class AuthorizationError(ApplicationError):
    status_code = 403
    code = "authorization_error"


class CsrfError(AuthorizationError):
    code = "csrf_failed"


class NotFoundError(ApplicationError):
    status_code = 404
    code = "not_found"


class ConflictError(ApplicationError):
    status_code = 409
    code = "conflict"


class VersionConflictError(ConflictError):
    code = "version_conflict"


class CancellationUnsupportedError(ConflictError):
    code = "cancellation_unsupported"


class RateLimitError(ApplicationError):
    status_code = 429
    code = "rate_limit"


class StorageUnavailableError(ApplicationError):
    status_code = 503
    code = "storage_unavailable"


class ExternalServiceError(ApplicationError):
    status_code = 502
    code = "external_service_error"


class ProviderError(ExternalServiceError):
    code = "provider_error"


class ProviderTaskFailedError(ProviderError):
    """Provider explicitly reports a terminal failure, not a poll transport error."""

    code = "provider_failed"


class TimeoutError(ExternalServiceError):
    """Provider or external call exceeded its deadline. Not the builtin timeout."""

    status_code = 504
    code = "timeout"

from app.core.errors import ConflictError, ExternalServiceError, NotFoundError, ValidationError


class SkillNotFoundError(NotFoundError):
    code = "skill_not_found"


class SkillDisabledError(ConflictError):
    code = "skill_disabled"


class SkillValidationError(ValidationError):
    code = "skill_validation_error"


class SkillExecutionError(ExternalServiceError):
    code = "skill_execution_error"

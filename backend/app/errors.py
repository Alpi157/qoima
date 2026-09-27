from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Base class for business-logic errors. Maps to an HTTP 4xx response with a Russian message."""

    status_code: int = 400
    default_message: str = "Ошибка запроса"

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class InvalidArticleError(AppError):
    status_code = 422


class InsufficientStockError(AppError):
    status_code = 409


class InvalidCredentialsError(AppError):
    status_code = 401
    default_message = "Неверный логин или пароль"


class NotAuthenticatedError(AppError):
    status_code = 401
    default_message = "Требуется вход"


class TooManyLoginAttemptsError(AppError):
    status_code = 429
    default_message = "Слишком много попыток входа. Попробуйте через минуту"


class UsernameTakenError(AppError):
    status_code = 409
    default_message = "Пользователь с таким логином уже существует"


class UserNotFoundError(AppError):
    status_code = 404
    default_message = "Пользователь не найден"


class InvalidUserDataError(AppError):
    status_code = 422


class ProductNotFoundError(AppError):
    status_code = 404
    default_message = "Товар не найден"


class DuplicateArticleError(AppError):
    status_code = 409


class CustomerNotFoundError(AppError):
    status_code = 404
    default_message = "Покупатель не найден"


class ProductArchivedError(AppError):
    status_code = 409


class InvalidDocumentLinesError(AppError):
    status_code = 422


class ReceiptNotFoundError(AppError):
    status_code = 404
    default_message = "Приход не найден"


class ReceiptAlreadyCancelledError(AppError):
    status_code = 409
    default_message = "Приход уже отменён"


class ReceiptCancelError(AppError):
    status_code = 409


class DocumentCustomerNotFoundError(AppError):
    """Customer referenced from a document body: the request is invalid, hence 422, not 404."""

    status_code = 422
    default_message = "Покупатель не найден"


class SaleNotFoundError(AppError):
    status_code = 404
    default_message = "Продажа не найдена"


class SaleAlreadyCancelledError(AppError):
    status_code = 409
    default_message = "Продажа уже отменена"


class SaleRequestConflictError(AppError):
    status_code = 409
    default_message = "Этот запрос уже использован для другой продажи"


VALIDATION_DETAIL = "Проверьте введённые данные"
DEFAULT_VALIDATION_MESSAGE = "Некорректное значение"

# Pydantic error type -> Russian message; {name} is filled from the error's ctx.
VALIDATION_MESSAGES = {
    "missing": "Обязательное поле",
    "extra_forbidden": "Лишнее поле",
    "string_too_short": "Минимальная длина: {min_length}",
    "string_too_long": "Максимальная длина: {max_length}",
    "greater_than": "Должно быть больше {gt}",
    "greater_than_equal": "Должно быть не меньше {ge}",
    "less_than": "Должно быть меньше {lt}",
    "less_than_equal": "Должно быть не больше {le}",
    "int_type": "Должно быть целым числом",
    "int_parsing": "Должно быть целым числом",
    "uuid_parsing": "Некорректный идентификатор (UUID)",
    "date_parsing": "Некорректная дата",
    "datetime_parsing": "Некорректные дата и время",
    "too_short": "Минимум элементов: {min_length}",
    "too_long": "Максимум элементов: {max_length}",
}


def validation_message(error: Mapping[str, Any]) -> str:
    ctx = error.get("ctx") or {}
    if error["type"] == "value_error" and "error" in ctx:
        return str(ctx["error"])
    template = VALIDATION_MESSAGES.get(error["type"])
    if template is None:
        return DEFAULT_VALIDATION_MESSAGE
    try:
        return template.format(**ctx)
    except (KeyError, IndexError):
        return DEFAULT_VALIDATION_MESSAGE


def validation_field(loc: tuple[int | str, ...]) -> str:
    """Dotted path to the field, without the leading "body": ("body", "lines", 0) -> "lines.0"."""
    parts = loc[1:] if loc and loc[0] == "body" else loc
    return ".".join(str(part) for part in parts)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            {"field": validation_field(tuple(e["loc"])), "message": validation_message(e)}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422, content={"detail": VALIDATION_DETAIL, "errors": errors}
        )

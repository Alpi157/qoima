from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorCode(StrEnum):
    """Machine-readable error code, sent as `code` in every 4xx error response."""

    APP_ERROR = "app_error"
    VALIDATION_ERROR = "validation_error"
    INVALID_ARTICLE = "invalid_article"
    INSUFFICIENT_STOCK = "insufficient_stock"
    INVALID_CREDENTIALS = "invalid_credentials"
    NOT_AUTHENTICATED = "not_authenticated"
    TOO_MANY_LOGIN_ATTEMPTS = "too_many_login_attempts"
    USERNAME_TAKEN = "username_taken"
    USER_NOT_FOUND = "user_not_found"
    INVALID_USER_DATA = "invalid_user_data"
    PRODUCT_NOT_FOUND = "product_not_found"
    DUPLICATE_ARTICLE = "duplicate_article"
    CUSTOMER_NOT_FOUND = "customer_not_found"
    PRODUCT_ARCHIVED = "product_archived"
    INVALID_DOCUMENT_LINES = "invalid_document_lines"
    RECEIPT_NOT_FOUND = "receipt_not_found"
    RECEIPT_ALREADY_CANCELLED = "receipt_already_cancelled"
    RECEIPT_CANCEL_BLOCKED = "receipt_cancel_blocked"
    DOCUMENT_CUSTOMER_NOT_FOUND = "document_customer_not_found"
    SALE_NOT_FOUND = "sale_not_found"
    SALE_ALREADY_CANCELLED = "sale_already_cancelled"
    SALE_REQUEST_CONFLICT = "sale_request_conflict"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    HTTP_ERROR = "http_error"


# Codes not tied to an AppError subclass: set by the framework-level handlers below.
FRAMEWORK_CODES = frozenset(
    {
        ErrorCode.APP_ERROR,
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.NOT_FOUND,
        ErrorCode.METHOD_NOT_ALLOWED,
        ErrorCode.HTTP_ERROR,
    }
)


class AppError(Exception):
    """Base class for business-logic errors. Maps to an HTTP 4xx response with a Russian message."""

    status_code: int = 400
    code: ErrorCode = ErrorCode.APP_ERROR
    default_message: str = "Ошибка запроса"

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class InvalidArticleError(AppError):
    code = ErrorCode.INVALID_ARTICLE
    status_code = 422


class InsufficientStockError(AppError):
    code = ErrorCode.INSUFFICIENT_STOCK
    status_code = 409


class InvalidCredentialsError(AppError):
    code = ErrorCode.INVALID_CREDENTIALS
    status_code = 401
    default_message = "Неверный логин или пароль"


class NotAuthenticatedError(AppError):
    code = ErrorCode.NOT_AUTHENTICATED
    status_code = 401
    default_message = "Требуется вход"


class TooManyLoginAttemptsError(AppError):
    code = ErrorCode.TOO_MANY_LOGIN_ATTEMPTS
    status_code = 429
    default_message = "Слишком много попыток входа. Попробуйте через минуту"


class UsernameTakenError(AppError):
    code = ErrorCode.USERNAME_TAKEN
    status_code = 409
    default_message = "Пользователь с таким логином уже существует"


class UserNotFoundError(AppError):
    code = ErrorCode.USER_NOT_FOUND
    status_code = 404
    default_message = "Пользователь не найден"


class InvalidUserDataError(AppError):
    code = ErrorCode.INVALID_USER_DATA
    status_code = 422


class ProductNotFoundError(AppError):
    code = ErrorCode.PRODUCT_NOT_FOUND
    status_code = 404
    default_message = "Товар не найден"


class DuplicateArticleError(AppError):
    code = ErrorCode.DUPLICATE_ARTICLE
    status_code = 409


class CustomerNotFoundError(AppError):
    code = ErrorCode.CUSTOMER_NOT_FOUND
    status_code = 404
    default_message = "Покупатель не найден"


class ProductArchivedError(AppError):
    code = ErrorCode.PRODUCT_ARCHIVED
    status_code = 409


class InvalidDocumentLinesError(AppError):
    code = ErrorCode.INVALID_DOCUMENT_LINES
    status_code = 422


class ReceiptNotFoundError(AppError):
    code = ErrorCode.RECEIPT_NOT_FOUND
    status_code = 404
    default_message = "Приход не найден"


class ReceiptAlreadyCancelledError(AppError):
    code = ErrorCode.RECEIPT_ALREADY_CANCELLED
    status_code = 409
    default_message = "Приход уже отменён"


class ReceiptCancelError(AppError):
    code = ErrorCode.RECEIPT_CANCEL_BLOCKED
    status_code = 409


class DocumentCustomerNotFoundError(AppError):
    """Customer referenced from a document body: the request is invalid, hence 422, not 404."""

    code = ErrorCode.DOCUMENT_CUSTOMER_NOT_FOUND
    status_code = 422
    default_message = "Покупатель не найден"


class SaleNotFoundError(AppError):
    code = ErrorCode.SALE_NOT_FOUND
    status_code = 404
    default_message = "Продажа не найдена"


class SaleAlreadyCancelledError(AppError):
    code = ErrorCode.SALE_ALREADY_CANCELLED
    status_code = 409
    default_message = "Продажа уже отменена"


class SaleRequestConflictError(AppError):
    code = ErrorCode.SALE_REQUEST_CONFLICT
    status_code = 409
    default_message = "Этот запрос уже использован для другой продажи"


class FieldErrorOut(BaseModel):
    field: str
    message: str


class ErrorOut(BaseModel):
    """Body of every 4xx response (see "Формат ошибок API" in docs/architecture.md)."""

    detail: str
    code: ErrorCode
    # Only in validation errors.
    errors: list[FieldErrorOut] | None = None


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


# Errors raised by the framework itself (unknown path, wrong method): status -> (code, message).
HTTP_ERRORS = {
    404: (ErrorCode.NOT_FOUND, "Не найдено"),
    405: (ErrorCode.METHOD_NOT_ALLOWED, "Метод не поддерживается"),
}
DEFAULT_HTTP_ERROR = (ErrorCode.HTTP_ERROR, "Ошибка запроса")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content={"detail": exc.message, "code": exc.code}
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            {"field": validation_field(tuple(e["loc"])), "message": validation_message(e)}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "detail": VALIDATION_DETAIL,
                "code": ErrorCode.VALIDATION_ERROR,
                "errors": errors,
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = HTTP_ERRORS.get(exc.status_code, DEFAULT_HTTP_ERROR)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": message, "code": code},
            headers=exc.headers,
        )

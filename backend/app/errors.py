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
    LINE_PRODUCT_NOT_FOUND = "line_product_not_found"
    DUPLICATE_LINE = "duplicate_line"
    AMOUNT_TOO_LARGE = "amount_too_large"
    NBK_RATE_MISMATCH = "nbk_rate_mismatch"
    EXPENSE_ZERO_WEIGHT = "expense_zero_weight"
    EXPENSE_MANUAL_SUM_MISMATCH = "expense_manual_sum_mismatch"
    RECEIPT_REQUEST_CONFLICT = "receipt_request_conflict"
    STOCK_ADJUSTMENT_REQUEST_CONFLICT = "stock_adjustment_request_conflict"
    ADJUSTMENT_COST_REQUIRED = "adjustment_cost_required"
    ADJUSTMENT_COST_NOT_ALLOWED = "adjustment_cost_not_allowed"
    RECEIPT_NOT_FOUND = "receipt_not_found"
    RECEIPT_ALREADY_CANCELLED = "receipt_already_cancelled"
    RECEIPT_CANCEL_BLOCKED = "receipt_cancel_blocked"
    DOCUMENT_CUSTOMER_NOT_FOUND = "document_customer_not_found"
    SALE_NOT_FOUND = "sale_not_found"
    SALE_ALREADY_CANCELLED = "sale_already_cancelled"
    SALE_REQUEST_CONFLICT = "sale_request_conflict"
    DEBT_REQUIRES_CUSTOMER = "debt_requires_customer"
    PAID_EXCEEDS_TOTAL = "paid_exceeds_total"
    DEBT_ADJUSTMENT_EXCEEDS_DEBT = "debt_adjustment_exceeds_debt"
    DEBT_ADJUSTMENT_REQUEST_CONFLICT = "debt_adjustment_request_conflict"
    DEBT_ADJUSTMENT_NOT_FOUND = "debt_adjustment_not_found"
    DEBT_ADJUSTMENT_ALREADY_CANCELLED = "debt_adjustment_already_cancelled"
    PAYMENT_EXCEEDS_DEBT = "payment_exceeds_debt"
    PAYMENT_REQUEST_CONFLICT = "payment_request_conflict"
    PAYMENT_NOT_FOUND = "payment_not_found"
    PAYMENT_ALREADY_CANCELLED = "payment_already_cancelled"
    SALE_NOT_POSTED = "sale_not_posted"
    RETURN_QTY_EXCEEDS_SOLD = "return_qty_exceeds_sold"
    RETURN_REQUEST_CONFLICT = "return_request_conflict"
    RETURN_NOT_FOUND = "return_not_found"
    RETURN_ALREADY_CANCELLED = "return_already_cancelled"
    RETURN_CANCEL_BLOCKED = "return_cancel_blocked"
    RETURN_SPLIT_CHANGED = "return_split_changed"
    SALE_HAS_RETURNS = "sale_has_returns"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    RATE_NOT_FOUND = "rate_not_found"
    RATE_DATE_IN_FUTURE = "rate_date_in_future"
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
    """Base class for business-logic errors. Maps to an HTTP 4xx response.

    `message` is Russian text for logs and debugging (sent as `detail`); `params` carries the
    data of the message, so the frontend builds the text by `code` in the user's language.
    The params of every code are listed in "Формат ошибок API" in docs/architecture.md.
    """

    status_code: int = 400
    code: ErrorCode = ErrorCode.APP_ERROR
    default_message: str = "Ошибка запроса"

    def __init__(self, message: str | None = None, params: dict[str, Any] | None = None) -> None:
        self.message = message or self.default_message
        self.params = params or {}
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


class LineProductNotFoundError(AppError):
    """A document line refers to a product that does not exist."""

    code = ErrorCode.LINE_PRODUCT_NOT_FOUND
    status_code = 422


class DuplicateLineError(AppError):
    """The same product appears in two lines of one document."""

    code = ErrorCode.DUPLICATE_LINE
    status_code = 422


class AmountTooLargeError(AppError):
    code = ErrorCode.AMOUNT_TOO_LARGE
    status_code = 422
    default_message = "Сумма слишком большая"


class ReceiptRequestConflictError(AppError):
    code = ErrorCode.RECEIPT_REQUEST_CONFLICT
    status_code = 409
    default_message = "Этот запрос уже использован для другого приёма"


class StockAdjustmentRequestConflictError(AppError):
    code = ErrorCode.STOCK_ADJUSTMENT_REQUEST_CONFLICT
    status_code = 409
    default_message = "Этот запрос уже использован для другой корректировки остатка"


class AdjustmentCostRequiredError(AppError):
    code = ErrorCode.ADJUSTMENT_COST_REQUIRED
    status_code = 422
    default_message = "Укажите закупочную цену: средняя себестоимость товара неизвестна"


class AdjustmentCostNotAllowedError(AppError):
    code = ErrorCode.ADJUSTMENT_COST_NOT_ALLOWED
    status_code = 422
    default_message = (
        "Закупочная цена нужна только при добавлении товара с неизвестной себестоимостью"
    )


class NbkRateMismatchError(AppError):
    code = ErrorCode.NBK_RATE_MISMATCH
    status_code = 422
    default_message = "Курс не совпадает с записью Нацбанка на эту дату"


class ExpenseZeroWeightError(AppError):
    code = ErrorCode.EXPENSE_ZERO_WEIGHT
    status_code = 422
    default_message = "Нельзя распределить расход: сумма весов равна нулю"


class ExpenseManualSumMismatchError(AppError):
    code = ErrorCode.EXPENSE_MANUAL_SUM_MISMATCH
    status_code = 422
    default_message = "Сумма ручных долей не равна сумме расхода в тиынах"


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


class DebtRequiresCustomerError(AppError):
    code = ErrorCode.DEBT_REQUIRES_CUSTOMER
    status_code = 422
    default_message = "Чтобы продать в долг, выберите покупателя."


class PaidExceedsTotalError(AppError):
    code = ErrorCode.PAID_EXCEEDS_TOTAL
    status_code = 422
    default_message = "Оплата не может быть больше суммы продажи"


class DebtAdjustmentExceedsDebtError(AppError):
    code = ErrorCode.DEBT_ADJUSTMENT_EXCEEDS_DEBT
    status_code = 409
    default_message = "Нельзя уменьшить больше текущего долга"


class DebtAdjustmentRequestConflictError(AppError):
    code = ErrorCode.DEBT_ADJUSTMENT_REQUEST_CONFLICT
    status_code = 409
    default_message = "Этот запрос уже использован для другого исправления долга"


class DebtAdjustmentNotFoundError(AppError):
    code = ErrorCode.DEBT_ADJUSTMENT_NOT_FOUND
    status_code = 404
    default_message = "Исправление долга не найдено"


class DebtAdjustmentAlreadyCancelledError(AppError):
    code = ErrorCode.DEBT_ADJUSTMENT_ALREADY_CANCELLED
    status_code = 409
    default_message = "Исправление долга уже отменено"


class PaymentExceedsDebtError(AppError):
    code = ErrorCode.PAYMENT_EXCEEDS_DEBT
    status_code = 409
    default_message = "Оплата больше долга"


class PaymentRequestConflictError(AppError):
    code = ErrorCode.PAYMENT_REQUEST_CONFLICT
    status_code = 409
    default_message = "Этот запрос уже использован для другой оплаты"


class PaymentNotFoundError(AppError):
    code = ErrorCode.PAYMENT_NOT_FOUND
    status_code = 404
    default_message = "Оплата не найдена"


class PaymentAlreadyCancelledError(AppError):
    code = ErrorCode.PAYMENT_ALREADY_CANCELLED
    status_code = 409
    default_message = "Оплата уже отменена"


class SaleNotPostedError(AppError):
    code = ErrorCode.SALE_NOT_POSTED
    status_code = 409
    default_message = "Возврат возможен только по проведённой продаже"


class ReturnQtyExceedsSoldError(AppError):
    code = ErrorCode.RETURN_QTY_EXCEEDS_SOLD
    status_code = 409


class ReturnRequestConflictError(AppError):
    code = ErrorCode.RETURN_REQUEST_CONFLICT
    status_code = 409
    default_message = "Этот запрос уже использован для другого возврата"


class ReturnNotFoundError(AppError):
    code = ErrorCode.RETURN_NOT_FOUND
    status_code = 404
    default_message = "Возврат не найден"


class ReturnAlreadyCancelledError(AppError):
    code = ErrorCode.RETURN_ALREADY_CANCELLED
    status_code = 409
    default_message = "Возврат уже отменён"


class ReturnCancelBlockedError(AppError):
    code = ErrorCode.RETURN_CANCEL_BLOCKED
    status_code = 409
    default_message = "Нельзя отменить возврат: товара на складе не хватает."


class ReturnSplitChangedError(AppError):
    code = ErrorCode.RETURN_SPLIT_CHANGED
    status_code = 409
    default_message = "Долг изменился, проверьте расчёт."


class SaleHasReturnsError(AppError):
    code = ErrorCode.SALE_HAS_RETURNS
    status_code = 409
    default_message = "По этой продаже есть возврат. Сначала отмените возврат."


class RateNotFoundError(AppError):
    code = ErrorCode.RATE_NOT_FOUND
    status_code = 404
    default_message = "Курс на эту дату и более ранние даты не найден"


class RateDateInFutureError(AppError):
    code = ErrorCode.RATE_DATE_IN_FUTURE
    status_code = 422
    default_message = "Дата курса не может быть в будущем"


class FieldErrorOut(BaseModel):
    field: str
    # Russian text, for logs and as a fallback when the frontend has no translation.
    message: str
    # Pydantic error type ("missing", "less_than_equal") or one of CUSTOM_VALIDATION_TYPES.
    type: str
    # Limits from the error context, e.g. {"le": 200}: JSON scalars only.
    params: dict[str, Any] = {}


class ErrorOut(BaseModel):
    """Body of every 4xx response (see "Формат ошибок API" in docs/architecture.md)."""

    detail: str
    code: ErrorCode
    params: dict[str, Any] = {}
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


# Our own error types, raised as PydanticCustomError in the schemas; the message is our text.
CUSTOM_VALIDATION_TYPES = frozenset(
    {
        "qty_zero",
        "amount_zero",
        "iin_bin_format",
        "date_in_future",
        "null_not_allowed",
        "payment_method_without_payment",
        "refund_method_without_refund",
        "return_expected_split_pair",
        "returned_at_before_sale",
        "sale_line_not_in_sale",
        "report_period_order",
        "report_period_too_long",
        "rate_format",
        "rate_not_allowed",
        "rate_required",
        "rate_date_required",
        "rate_date_not_allowed",
        "rate_date_after_receipt",
        "line_price_required",
        "line_price_both",
        "unit_cost_kzt_only",
        "expense_targets_required",
        "expense_targets_not_allowed",
        "expense_target_not_in_receipt",
        "expense_target_duplicate",
    }
)


def validation_message(error: Mapping[str, Any]) -> str:
    ctx = error.get("ctx") or {}
    if error["type"] in CUSTOM_VALIDATION_TYPES:
        return str(error["msg"])
    if error["type"] == "value_error" and "error" in ctx:
        return str(ctx["error"])
    template = VALIDATION_MESSAGES.get(error["type"])
    if template is None:
        return DEFAULT_VALIDATION_MESSAGE
    try:
        return template.format(**ctx)
    except (KeyError, IndexError):
        return DEFAULT_VALIDATION_MESSAGE


def validation_params(error: Mapping[str, Any]) -> dict[str, Any]:
    """JSON-safe values of the error context, e.g. {"le": 200}; objects are left out."""
    ctx = error.get("ctx") or {}
    return {
        key: value
        for key, value in ctx.items()
        if isinstance(value, str | int | float | bool)
        or (isinstance(value, list) and all(isinstance(item, str | int) for item in value))
    }


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
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code, "params": exc.params},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            {
                "field": validation_field(tuple(e["loc"])),
                "message": validation_message(e),
                "type": e["type"],
                "params": validation_params(e),
            }
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "detail": VALIDATION_DETAIL,
                "code": ErrorCode.VALIDATION_ERROR,
                "params": {},
                "errors": errors,
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = HTTP_ERRORS.get(exc.status_code, DEFAULT_HTTP_ERROR)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": message, "code": code, "params": {}},
            headers=exc.headers,
        )

from fastapi import FastAPI, Request
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


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

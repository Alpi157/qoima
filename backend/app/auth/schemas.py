from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict

# Interface languages: Kazakh, Russian, Chinese (the users.locale CHECK constraint matches).
Locale = Literal["kk", "ru", "zh"]
LOCALES: tuple[str, ...] = get_args(Locale)


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    role: str
    locale: Locale


class UserUpdate(BaseModel):
    """PATCH /api/auth/me: settings the user changes for themselves."""

    model_config = ConfigDict(extra="forbid")

    locale: Locale

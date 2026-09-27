"""Admin commands. Usage: uv run python -m app.cli <command> ..."""

import argparse
import sys
from getpass import getpass

from sqlalchemy.orm import Session

from app import models  # noqa: F401  (registers every model so cross-module FKs resolve)
from app.auth import service
from app.db import SessionLocal
from app.errors import AppError


def _read_password() -> str | None:
    password = getpass("Пароль: ")
    repeat = getpass("Повторите пароль: ")
    if password != repeat:
        print("Пароли не совпадают", file=sys.stderr)
        return None
    return password


def create_user_command(db: Session, username: str, full_name: str) -> int:
    password = _read_password()
    if password is None:
        return 1
    try:
        user = service.create_user(db, username, full_name, password)
    except AppError as exc:
        print(exc.message, file=sys.stderr)
        return 1
    print(f"Пользователь «{user.username}» создан")
    return 0


def set_password_command(db: Session, username: str) -> int:
    password = _read_password()
    if password is None:
        return 1
    try:
        user = service.set_password(db, username, password)
    except AppError as exc:
        print(exc.message, file=sys.stderr)
        return 1
    print(f"Пароль пользователя «{user.username}» изменён")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli", description="Администрирование Qoima")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create-user", help="создать пользователя")
    create.add_argument("--username", required=True, help="логин")
    create.add_argument("--full-name", required=True, help="имя для отображения")

    set_pw = commands.add_parser("set-password", help="сменить пароль пользователя")
    set_pw.add_argument("--username", required=True, help="логин")

    args = parser.parse_args(argv)
    with SessionLocal() as db:
        if args.command == "create-user":
            return create_user_command(db, args.username, args.full_name)
        return set_password_command(db, args.username)


if __name__ == "__main__":
    sys.exit(main())

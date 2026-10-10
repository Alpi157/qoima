"""Admin commands. Usage: uv run python -m app.cli <command> ..."""

import argparse
import sys
from getpass import getpass
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import models  # noqa: F401  (registers every model so cross-module FKs resolve)
from app.auth import service
from app.auth.models import DEFAULT_LOCALE
from app.auth.schemas import LOCALES
from app.db import SessionLocal
from app.errors import AppError
from app.importer import ImportFailure, import_products


def _read_password() -> str | None:
    password = getpass("Пароль: ")
    repeat = getpass("Повторите пароль: ")
    if password != repeat:
        print("Пароли не совпадают", file=sys.stderr)
        return None
    return password


def create_user_command(
    db: Session, username: str, full_name: str, locale: str = DEFAULT_LOCALE
) -> int:
    password = _read_password()
    if password is None:
        return 1
    try:
        user = service.create_user(db, username, full_name, password, locale)
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


def _format_number(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def _format_money(amount: int) -> str:
    tenge, tiyn = divmod(abs(amount), 100)
    fraction = f",{tiyn:02d}" if tiyn else ""
    sign = "-" if amount < 0 else ""
    return f"{sign}{_format_number(tenge)}{fraction} ₸"


def import_products_command(db: Session, path: Path, username: str, apply: bool = False) -> int:
    try:
        result = import_products(db, path, username, apply=apply)
    except ImportFailure as exc:
        print("Импорт не выполнен:", file=sys.stderr)
        for issue in exc.issues:
            print(f"  {issue}", file=sys.stderr)
        return 1
    except SQLAlchemyError:
        db.rollback()
        print("Импорт не выполнен: ошибка подключения или чтения базы", file=sys.stderr)
        return 1
    summary = result.summary
    print("Импорт выполнен" if apply else "Пробный прогон: база не изменена")
    print(f"Товаров: {_format_number(summary.products)}")
    print(f"Из них с остатком: {_format_number(summary.with_stock)}")
    print(f"Всего штук: {_format_number(summary.total_qty)}")
    print(f"Стоимость по закупке: {_format_money(summary.cost_value)}")
    print(f"Стоимость по продаже: {_format_money(summary.retail_value)}")
    for warning in result.warnings:
        print(f"Предупреждение: {warning}")
    if apply:
        numbers = ", ".join(map(str, result.receipt_numbers)) or "нет"
        print(f"Номера созданных приёмов: {numbers}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli", description="Администрирование Qoima")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create-user", help="создать пользователя")
    create.add_argument("--username", required=True, help="логин")
    create.add_argument("--full-name", required=True, help="имя для отображения")
    create.add_argument(
        "--locale",
        choices=LOCALES,
        default=DEFAULT_LOCALE,
        help=f"язык интерфейса (по умолчанию {DEFAULT_LOCALE})",
    )

    set_pw = commands.add_parser("set-password", help="сменить пароль пользователя")
    set_pw.add_argument("--username", required=True, help="логин")

    products = commands.add_parser(
        "import-products", help="импортировать товары и начальные остатки из XLSX"
    )
    products.add_argument("path", type=Path, help="путь к XLSX с листом «Товары»")
    products.add_argument("--user", required=True, help="логин автора приёмов")
    products.add_argument(
        "--apply", action="store_true", help="записать импорт; без флага только проверка"
    )

    args = parser.parse_args(argv)
    with SessionLocal() as db:
        if args.command == "create-user":
            return create_user_command(db, args.username, args.full_name, args.locale)
        if args.command == "import-products":
            return import_products_command(db, args.path, args.user, args.apply)
        return set_password_command(db, args.username)


if __name__ == "__main__":
    sys.exit(main())

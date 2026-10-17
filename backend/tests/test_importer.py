from contextlib import nullcontext
from datetime import date
from pathlib import Path
from unittest.mock import Mock

import pytest
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import cli, importer
from app.catalog import service as catalog_service
from app.catalog.models import Product
from app.catalog.schemas import MAX_SALE_PRICE
from app.errors import InvalidArticleError
from app.importer import ImportFailure, ImportSummary, import_products
from app.inventory.models import StockBalance, StockMovement
from app.numbering import DocumentCounter
from app.receipts import service as receipt_service
from app.receipts.models import Receipt, ReceiptLine
from app.schema_types import MAX_LINES, MAX_QTY
from tests.factories import create_product, create_user
from tests.import_helpers import HEADERS, product_row, write_example, write_products


def snapshot(db: Session) -> tuple:
    counts = tuple(
        db.scalar(select(func.count()).select_from(model))
        for model in (Product, Receipt, ReceiptLine, StockBalance, StockMovement)
    )
    return (
        *counts,
        db.scalar(select(DocumentCounter.last_number).where(DocumentCounter.doc_type == "receipt")),
    )


@pytest.fixture
def import_db(db_session):
    create_user(db_session, username="owner")
    db_session.commit()
    return db_session


def test_dry_run_summary_warnings_and_no_writes(import_db, tmp_path, monkeypatch):
    path = write_example(tmp_path / "example.xlsx")
    before = snapshot(import_db)
    commit = Mock(wraps=import_db.commit)
    monkeypatch.setattr(import_db, "commit", commit)
    result = import_products(import_db, path, " Owner ")
    assert result.summary == ImportSummary(3, 2, 5, 440_000, 690_000)
    assert [(issue.row, issue.column) for issue in result.warnings] == [(4, "Остаток")]
    assert result.receipt_numbers == []
    assert snapshot(import_db) == before
    commit.assert_not_called()


def test_apply_products_receipts_costs_and_single_commit(import_db, tmp_path, monkeypatch):
    path = write_example(tmp_path / "example.xlsx")
    commit = Mock(wraps=import_db.commit)
    monkeypatch.setattr(import_db, "commit", commit)
    result = import_products(import_db, path, "owner", apply=True)
    commit.assert_called_once_with()
    assert result.summary == ImportSummary(3, 2, 5, 440_000, 690_000)
    products = {p.article: p for p in import_db.scalars(select(Product))}
    assert set(products) == {"SYN-OC-90", "55490097", "SYN-ZERO"}
    first = products["SYN-OC-90"]
    assert (first.article_norm, first.sale_price, first.min_qty, first.unit) == (
        "SYNOC90",
        150_000,
        2,
        "шт",
    )
    assert first.note == "Вымышленный фильтр для проверки импорта"
    second = products["55490097"]
    assert (second.article_norm, second.sale_price, second.min_qty, second.note) == (
        "55490097",
        120_000,
        None,
        None,
    )
    receipt = import_db.scalars(select(Receipt)).one()
    assert result.receipt_numbers == [receipt.number]
    assert (receipt.status, receipt.supplier, receipt.note) == (
        "posted",
        "X2",
        "Бастапқы қалдық, X2-ден көшіру",
    )
    balances = {b.product_id: (b.qty, b.avg_cost) for b in import_db.scalars(select(StockBalance))}
    assert balances == {first.id: (3, 100_000), second.id: (2, 70_000)}
    lines = {
        line.product_id: (line.qty, line.unit_cost)
        for line in import_db.scalars(select(ReceiptLine))
    }
    assert lines == balances
    for line in import_db.scalars(select(ReceiptLine)):
        product = import_db.get(Product, line.product_id)
        assert (line.article, line.name, line.unit) == (product.article, product.name, product.unit)
    movements = list(import_db.scalars(select(StockMovement)))
    assert len(movements) == 2
    assert all(
        m.kind == "receipt"
        and m.doc_type == "receipt"
        and m.doc_id == receipt.id
        and m.created_by == receipt.created_by
        for m in movements
    )
    assert {(m.product_id, m.qty, m.unit_cost) for m in movements} == {
        (first.id, 3, 100_000),
        (second.id, 2, 70_000),
    }


def test_columns_defaults_ignored_sheets_and_blank_rows(import_db, tmp_path):
    row = product_row(
        **{
            "Артикул": "001-TEST",
            "Единица": " ",
            "Остаток": None,
            "Закупочная цена, ₸": None,
            "Цена продажи, ₸": "0",
        }
    )
    path = write_products(
        tmp_path / "mixed.xlsx",
        [row, {}, {"Проверить": "только служебные данные"}],
        headers=["Проверить", "Чужая колонка", *reversed(HEADERS[:-1])],
    )
    result = import_products(import_db, path, "owner", apply=True)
    product = import_db.scalars(select(Product)).one()
    assert (product.article, product.unit, product.sale_price, product.min_qty, product.note) == (
        "001-TEST",
        "шт",
        0,
        None,
        None,
    )
    assert result.summary == ImportSummary(1, 0, 0, 0, 0)
    assert result.receipt_numbers == []
    assert snapshot(import_db)[:5] == (1, 0, 0, 0, 0)


def test_zero_prices_minimum_and_trimmed_notes(import_db, tmp_path):
    path = write_products(
        tmp_path / "zero-prices.xlsx",
        [
            product_row(
                **{
                    "Цена продажи, ₸": "0",
                    "Закупочная цена, ₸": "0",
                    "Остаток": "2",
                    "Мин. остаток": "0",
                    "Примечание": "  Synthetic  ",
                }
            ),
        ],
    )
    result = import_products(import_db, path, "owner", apply=True)
    product = import_db.scalars(select(Product)).one()
    balance = import_db.scalars(select(StockBalance)).one()
    assert (product.sale_price, product.min_qty, product.note) == (0, 0, "Synthetic")
    assert (balance.qty, balance.avg_cost) == (2, 0)
    assert result.summary == ImportSummary(1, 1, 2, 0, 0)


@pytest.mark.parametrize("unit", importer.UNITS)
def test_known_units(import_db, tmp_path, unit):
    path = write_products(tmp_path / "units.xlsx", [product_row(**{"Единица": unit})])
    assert import_products(import_db, path, "owner").summary.products == 1


def test_equal_and_higher_cost_warnings(import_db, tmp_path):
    path = write_products(
        tmp_path / "warnings.xlsx",
        [
            product_row(**{"Артикул": "EQ", "Цена продажи, ₸": 1000}),
            product_row(**{"Артикул": "HIGH", "Цена продажи, ₸": 500, "Остаток": 0}),
        ],
    )
    result = import_products(import_db, path, "owner")
    assert [(w.row, w.column) for w in result.warnings] == [
        (2, "Закупочная цена, ₸"),
        (3, "Закупочная цена, ₸"),
        (3, "Остаток"),
    ]


@pytest.mark.parametrize(
    "column", ["Цена продажи, ₸", "Закупочная цена, ₸", "Остаток", "Мин. остаток"]
)
@pytest.mark.parametrize("value", [-1, 1.5, "1.5", "abc", True, date(2026, 1, 1), "=1+1"])
def test_invalid_numbers_report_row_and_column(import_db, tmp_path, column, value):
    path = write_products(tmp_path / "invalid.xlsx", [{}, product_row(**{column: value})])
    before = snapshot(import_db)
    with pytest.raises(ImportFailure) as exc:
        import_products(import_db, path, "owner", apply=True)
    assert any(issue.row == 3 and issue.column == column for issue in exc.value.issues)
    assert snapshot(import_db) == before


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("Артикул", None),
        ("Артикул", "---"),
        ("Артикул", "A" * 65),
        ("Название", None),
        ("Название", "N" * 256),
        ("Единица", "ящик"),
        ("Цена продажи, ₸", None),
        ("Закупочная цена, ₸", None),
        ("Цена продажи, ₸", MAX_SALE_PRICE // 100 + 1),
        ("Закупочная цена, ₸", MAX_SALE_PRICE // 100 + 1),
        ("Остаток", MAX_QTY + 1),
        ("Мин. остаток", 2**31),
        ("Примечание", "N" * 1001),
    ],
)
def test_required_fields_unknown_unit_and_schema_limits(import_db, tmp_path, column, value):
    path = write_products(tmp_path / "invalid.xlsx", [product_row(**{column: value})])
    with pytest.raises(ImportFailure) as exc:
        import_products(import_db, path, "owner", apply=True)
    assert any(issue.row == 2 and issue.column == column for issue in exc.value.issues)
    if column in ("Цена продажи, ₸", "Закупочная цена, ₸") and value == MAX_SALE_PRICE // 100 + 1:
        assert "1000000000 тенге" in str(exc.value)
    assert snapshot(import_db)[:5] == (0, 0, 0, 0, 0)


def test_all_errors_and_normalized_duplicates_even_in_invalid_rows(import_db, tmp_path):
    create_product(import_db, article="OC90", is_archived=True)
    import_db.commit()
    path = write_products(
        tmp_path / "all-errors.xlsx",
        [
            product_row(
                **{
                    "Артикул": None,
                    "Название": None,
                    "Единица": "ящик",
                    "Цена продажи, ₸": 1.5,
                    "Закупочная цена, ₸": None,
                    "Мин. остаток": -1,
                }
            ),
            product_row(**{"Артикул": "OC-90", "Остаток": -1}),
            product_row(**{"Артикул": "ос90"}),
        ],
    )
    before = snapshot(import_db)
    with pytest.raises(ImportFailure) as exc:
        import_products(import_db, path, "missing", apply=True)
    errors = exc.value.issues
    assert {(i.row, i.column) for i in errors} >= {
        (None, "Параметр --user"),
        (2, "Артикул"),
        (2, "Название"),
        (2, "Единица"),
        (2, "Цена продажи, ₸"),
        (2, "Закупочная цена, ₸"),
        (2, "Мин. остаток"),
        (3, "Остаток"),
        (3, "Артикул"),
        (4, "Артикул"),
    }
    assert {i.row for i in errors if "Повтор артикула" in i.message} == {3, 4}
    assert {i.row for i in errors if "уже есть в базе" in i.message} == {3, 4}
    assert snapshot(import_db) == before


@pytest.mark.parametrize("apply", [False, True])
def test_last_row_validation_is_atomic(import_db, tmp_path, apply):
    path = write_products(
        tmp_path / "last.xlsx", [product_row(), product_row(**{"Артикул": "LAST", "Остаток": 1.5})]
    )
    with pytest.raises(ImportFailure):
        import_products(import_db, path, "owner", apply=apply)
    assert snapshot(import_db)[:5] == (0, 0, 0, 0, 0)


def test_repeat_reports_every_row_and_changes_nothing(import_db, tmp_path):
    path = write_example(tmp_path / "repeat.xlsx")
    import_products(import_db, path, "owner", apply=True)
    before = snapshot(import_db)
    with pytest.raises(ImportFailure) as exc:
        import_products(import_db, path, "owner", apply=True)
    assert [(i.row, i.column, i.message) for i in exc.value.issues] == [
        (row, "Артикул", "Артикул уже есть в базе") for row in (2, 3, 4)
    ]
    assert snapshot(import_db) == before


def test_splits_receipts_using_the_existing_limit(import_db, tmp_path, monkeypatch):
    path = write_products(
        tmp_path / "large.xlsx",
        [product_row(**{"Артикул": f"SYN-{i}"}) for i in range(MAX_LINES + 1)],
    )
    commit = Mock(wraps=import_db.commit)
    monkeypatch.setattr(import_db, "commit", commit)
    result = import_products(import_db, path, "owner", apply=True)
    commit.assert_called_once_with()
    receipts = list(import_db.scalars(select(Receipt).order_by(Receipt.number)))
    assert result.receipt_numbers == [r.number for r in receipts]
    assert len(receipts) == 2
    assert [
        import_db.scalar(
            select(func.count()).select_from(ReceiptLine).where(ReceiptLine.receipt_id == r.id)
        )
        for r in receipts
    ] == [MAX_LINES, 1]
    assert snapshot(import_db)[:5] == (
        MAX_LINES + 1,
        2,
        MAX_LINES + 1,
        MAX_LINES + 1,
        MAX_LINES + 1,
    )


def test_write_error_after_second_receipt_rolls_back_everything(
    isolated_stock_engine, tmp_path, monkeypatch
):
    with Session(isolated_stock_engine) as db:
        create_user(db, username="owner")
        db.commit()
    path = write_products(
        tmp_path / "late.xlsx",
        [product_row(**{"Артикул": f"SYN-{i}"}) for i in range(MAX_LINES + 1)],
    )
    original = receipt_service._post_receipt
    calls = 0

    def fail_after_posting(*args, **kwargs):
        nonlocal calls
        receipt = original(*args, **kwargs)
        calls += 1
        if calls == 2:
            raise InvalidArticleError("Искусственная ошибка после движения")
        return receipt

    monkeypatch.setattr(receipt_service, "_post_receipt", fail_after_posting)
    with Session(isolated_stock_engine) as db:
        with pytest.raises(ImportFailure, match="Все изменения импорта отменены"):
            import_products(db, path, "owner", apply=True)
    assert calls == 2
    with Session(isolated_stock_engine) as check:
        assert snapshot(check) == (0, 0, 0, 0, 0, 0)


def test_unique_violation_during_last_product_rolls_back(
    isolated_stock_engine, tmp_path, monkeypatch
):
    with Session(isolated_stock_engine) as db:
        create_user(db, username="owner")
        create_product(db, article="TAKEN")
        db.commit()
    path = write_products(
        tmp_path / "race.xlsx", [product_row(), product_row(**{"Артикул": "TAKEN"})]
    )
    original = importer._existing_issues
    calls = 0

    def miss_precheck(db, articles):
        nonlocal calls
        calls += 1
        return [] if calls == 1 else original(db, articles)

    monkeypatch.setattr(importer, "_existing_issues", miss_precheck)
    monkeypatch.setattr(catalog_service, "_ensure_article_free", lambda *args, **kwargs: None)
    with Session(isolated_stock_engine) as db:
        with pytest.raises(ImportFailure) as exc:
            import_products(db, path, "owner", apply=True)
        assert [(i.row, i.column, i.message) for i in exc.value.issues] == [
            (3, "Артикул", "Артикул уже есть в базе")
        ]
    with Session(isolated_stock_engine) as check:
        assert snapshot(check) == (1, 0, 0, 0, 0, 0)
        assert check.scalars(select(Product.article)).all() == ["TAKEN"]


def test_commit_failure_rolls_back(isolated_stock_engine, tmp_path, monkeypatch):
    with Session(isolated_stock_engine) as db:
        create_user(db, username="owner")
        db.commit()
    path = write_products(tmp_path / "commit.xlsx", [product_row()])
    with Session(isolated_stock_engine) as db:

        def fail_commit():
            raise OperationalError(None, None, RuntimeError("injected failure"))

        monkeypatch.setattr(db, "commit", fail_commit)
        with pytest.raises(ImportFailure, match="Все изменения импорта отменены"):
            import_products(db, path, "owner", apply=True)
    with Session(isolated_stock_engine) as check:
        assert snapshot(check) == (0, 0, 0, 0, 0, 0)


def test_header_errors_and_unknown_user_are_reported_together(import_db, tmp_path):
    path = write_products(tmp_path / "headers.xlsx", [], headers=["Артикул", "Артикул", "название"])
    with pytest.raises(ImportFailure) as exc:
        import_products(import_db, path, "missing", apply=True)
    assert any(
        i.row == 1 and i.column == "Артикул" and "повторяется" in i.message
        for i in exc.value.issues
    )
    assert {i.column for i in exc.value.issues if "Нет обязательного" in i.message} == set(
        HEADERS[1:-1]
    )
    assert any(i.column == "Параметр --user" for i in exc.value.issues)


@pytest.mark.parametrize("kind", ["missing", "corrupt", "wrong_sheet"])
def test_unreadable_file_and_missing_sheet(import_db, tmp_path, kind):
    path = tmp_path / "file.xlsx"
    if kind == "corrupt":
        path.write_text("not an xlsx")
    elif kind == "wrong_sheet":
        book = Workbook()
        book.save(path)
        book.close()
    with pytest.raises(ImportFailure) as exc:
        import_products(import_db, path, "owner", apply=True)
    assert exc.value.issues[0].column == "Файл"
    assert snapshot(import_db)[:5] == (0, 0, 0, 0, 0)


def test_cli_dry_run_and_apply(import_db, tmp_path, monkeypatch, capsys):
    path = write_example(tmp_path / "cli.xlsx")
    monkeypatch.setattr(cli, "SessionLocal", lambda: nullcontext(import_db))
    assert cli.main(["import-products", str(path), "--user", "owner"]) == 0
    output = capsys.readouterr()
    assert not output.err
    assert "Пробный прогон: база не изменена" in output.out
    assert "Товаров: 3" in output.out and "Из них с остатком: 2" in output.out
    assert "Всего штук: 5" in output.out
    assert "Стоимость по закупке: 4 400 ₸" in output.out
    assert "Стоимость по продаже: 6 900 ₸" in output.out
    assert "Предупреждение: Строка 4, колонка «Остаток»" in output.out
    assert cli.main(["import-products", str(path), "--user", "owner", "--apply"]) == 0
    output = capsys.readouterr()
    assert "Импорт выполнен" in output.out and "Номера созданных приёмов:" in output.out
    assert cli.main(["import-products", str(path), "--user", "owner", "--apply"]) == 1
    output = capsys.readouterr()
    assert not output.out
    assert all(f"Строка {row}, колонка «Артикул»" in output.err for row in (2, 3, 4))


def test_cli_unknown_user_nonzero_and_no_stdout(import_db, tmp_path, capsys):
    path = write_products(tmp_path / "user.xlsx", [product_row()])
    assert cli.import_products_command(import_db, path, "missing", apply=True) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert "Параметр --user: Пользователь не найден" in output.err


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        (421_104_000, "4 211 040 ₸"),
        (1_250_050, "12 500,50 ₸"),
        (1, "0,01 ₸"),
        (0, "0 ₸"),
    ],
)
def test_cli_formats_money_without_rounding(amount, expected):
    assert cli._format_money(amount) == expected


def test_synthetic_fixture_is_readable_and_not_created_by_regular_tests(import_db):
    path = Path(__file__).parent / "fixtures" / "qoima-import-example.xlsx"
    assert import_products(import_db, path, "owner").summary == ImportSummary(
        3, 2, 5, 440_000, 690_000
    )

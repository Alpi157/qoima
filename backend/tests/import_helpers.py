"""Synthetic XLSX fixtures. Generate the example with python -m tests.import_helpers PATH."""

import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

HEADERS = [
    "Артикул",
    "Название",
    "Единица",
    "Цена продажи, ₸",
    "Закупочная цена, ₸",
    "Остаток",
    "Мин. остаток",
    "Примечание",
]


def product_row(**changes: object) -> dict[str, object]:
    return {
        "Артикул": "SYN-1",
        "Название": "Синтетический товар",
        "Единица": "шт",
        "Цена продажи, ₸": 1500,
        "Закупочная цена, ₸": 1000,
        "Остаток": 2,
        "Мин. остаток": None,
        "Примечание": None,
        **changes,
    }


def write_products(
    path: Path,
    rows: list[dict[str, object]],
    headers: list[str] | None = None,
) -> Path:
    book = Workbook()
    sheet = book.active
    sheet.title = "Товары"
    headers = HEADERS if headers is None else headers
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for row in rows:
        sheet.append([row.get(header) for header in headers])
    sheet.freeze_panes = "A2"
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 26
        if column[0].value in ("Цена продажи, ₸", "Закупочная цена, ₸"):
            for cell in column[1:]:
                if cell.data_type == "n":
                    cell.number_format = "#,##0"
    instructions = book.create_sheet("Как заполнить")
    instructions.append(["Синтетический пример: все товары и цены вымышлены."])
    instructions.append(["Заполняйте лист Товары; цены в целых тенге, количество целое."])
    instructions.append(
        ["При положительном остатке укажите закупочную цену; формулы замените значениями."]
    )
    instructions.append(
        ["Рабочие файлы храните в папке import/ в корне проекта, исключённой из git."]
    )
    instructions.column_dimensions["A"].width = 100
    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    book.close()
    return path


def write_example(path: Path) -> Path:
    return write_products(
        path,
        [
            product_row(
                **{
                    "Артикул": "SYN-OC-90",
                    "Остаток": 3,
                    "Мин. остаток": 2,
                    "Примечание": "Вымышленный фильтр для проверки импорта",
                }
            ),
            product_row(
                **{
                    "Артикул": 55490097,
                    "Название": "Синтетическая деталь",
                    "Цена продажи, ₸": 1200,
                    "Закупочная цена, ₸": 700,
                }
            ),
            product_row(**{"Артикул": "SYN-ZERO", "Остаток": 0, "Закупочная цена, ₸": None}),
        ],
        headers=[*HEADERS, "Категория", "Как в X2 (не менять)", "Проверить"],
    )


if __name__ == "__main__":
    write_example(Path(sys.argv[1]))

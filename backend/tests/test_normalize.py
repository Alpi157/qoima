import pytest

from app.catalog.normalize import normalize_article
from app.errors import InvalidArticleError


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Examples from docs/architecture.md
        ("ос-90", "OC90"),
        ("OC 90", "OC90"),
        ("0986.452.041", "0986452041"),
        ("ab/12_3", "AB123"),
        # Cyrillic lookalikes mixed with Latin letters
        ("Oс-90", "OC90"),
        ("ОC-90", "OC90"),
        ("вмх-1ТУ", "BMX1TY"),
        ("Ёж-1", "EЖ1"),
        ("аВеКмНоРсТуХ", "ABEKMHOPCTYX"),
        # Non-lookalike Cyrillic letters are kept
        ("жд-15", "ЖД15"),
        # NFKC: full-width characters become ASCII
        ("ＯＣ９０", "OC90"),
        ("  oc\t90\n", "OC90"),
    ],
)
def test_normalize_article(raw: str, expected: str) -> None:
    assert normalize_article(raw) == expected


def test_normalize_is_idempotent() -> None:
    once = normalize_article("ос-90/Ж")
    assert normalize_article(once) == once


def test_letter_o_and_digit_zero_differ() -> None:
    assert normalize_article("O1") == "O1"
    assert normalize_article("01") == "01"
    assert normalize_article("O1") != normalize_article("01")


@pytest.mark.parametrize("raw", ["- . /", "", "   ", "---", "_/._"])
def test_empty_after_normalization_raises(raw: str) -> None:
    with pytest.raises(InvalidArticleError, match="Артикул не может быть пустым"):
        normalize_article(raw)

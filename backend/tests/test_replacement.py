from fractions import Fraction

import pytest

from app.receipts.replacement import (
    ReplacementExpense,
    calculate_replacement,
    markup_percent,
    price_for_markup,
)


def reference_expenses():
    return [ReplacementExpense(7_000_000), ReplacementExpense(3_500_000, "CNY", 700_000)]


@pytest.mark.parametrize(
    "rate, expected, goods, revalued",
    [(850_000, 962_500, 850_000, 42_500), (600_000, 700_000, 600_000, 30_000)],
)
def test_references_7_and_9(rate, expected, goods, revalued):
    result = calculate_replacement(100, 10_000, "CNY", reference_expenses(), {"CNY": rate})
    assert (result.unit_cost, result.goods, result.fixed, result.revalued) == (
        expected,
        goods,
        70_000,
        revalued,
    )
    if rate == 850_000:
        assert markup_percent(1_450_000, 805_000) == 80
        assert markup_percent(1_450_000, result.unit_cost) == 51
        assert price_for_markup(result.unit_cost, 80) == 1_732_500
    else:
        assert result.unit_cost - 805_000 == -105_000


def test_expense_uses_its_own_usd_basis():
    result = calculate_replacement(
        2,
        100,
        "CNY",
        [ReplacementExpense(900, "USD", 4_500_000)],
        {"CNY": 850_000, "USD": 5_000_000},
    )
    assert result.revalued == 500
    assert result.unit_cost == 9000


def test_vat_credit_reference_4_is_excluded_and_capitalized_vat_is_revalued():
    base = reference_expenses()
    credit = calculate_replacement(
        100,
        10_000,
        "CNY",
        [*base, ReplacementExpense(6_666_667, "CNY", 700_000, True)],
        {"CNY": 850_000},
    )
    assert credit.unit_cost == 962_500
    capitalized = calculate_replacement(
        100, 10_000, "CNY", [*base, ReplacementExpense(6_666_667, "CNY", 700_000)], {"CNY": 850_000}
    )
    assert capitalized.unit_cost == 1_043_452


def test_one_final_rounding_not_rounded_parts():
    result = calculate_replacement(
        1, 1, "CNY", [ReplacementExpense(1, "CNY", 10_000)], {"CNY": 5000}
    )
    assert result.goods == result.revalued == Fraction(1, 2)
    assert result.unit_cost == 1


def test_old_kzt_and_zero_vat_and_zero_allocations_need_no_rates():
    assert calculate_replacement(3, 805_000, "KZT", [], {}).unit_cost == 805_000
    assert (
        calculate_replacement(
            1,
            0,
            "KZT",
            [ReplacementExpense(1, "USD", 1, True), ReplacementExpense(0, "USD", 1)],
            {},
        ).unit_cost
        == 0
    )


@pytest.mark.parametrize(
    "price,cost,expected",
    [
        (0, 100, -100),
        (1, 200, -100),
        (99, 200, -51),
        (201, 200, 1),
        (0, 0, None),
        (100, None, None),
    ],
)
def test_signed_markup_rounding(price, cost, expected):
    assert markup_percent(price, cost) == expected


def test_keep_markup_null_or_negative_result():
    assert price_for_markup(100, None) is None
    assert price_for_markup(100, -101) is None
    assert price_for_markup(100, -100) == 0

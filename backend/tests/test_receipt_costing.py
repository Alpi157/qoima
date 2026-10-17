from itertools import permutations
from random import Random

import pytest

from app.catalog.schemas import MAX_SALE_PRICE
from app.errors import AmountTooLargeError, ExpenseManualSumMismatchError, ExpenseZeroWeightError
from app.inventory.service import round_half_up
from app.receipts.costing import CostExpense, CostLine, calculate_receipt_costs
from app.schema_types import MAX_MONEY

LINES = [CostLine(1, 100, 10_000), CostLine(2, 200, 2_500)]
EXPENSES = [CostExpense("delivery", 10_500_000), CostExpense("customs_duty", 5_250_000)]


def calculate(lines=LINES, expenses=EXPENSES, vat=False, rate=700_000, currency="CNY"):
    return calculate_receipt_costs(lines, rate, currency, expenses, vat)


def test_reference_1():
    result = calculate()
    assert [v.goods_total for v in result.lines.values()] == [70_000_000, 35_000_000]
    assert result.expenses[0].allocations == {1: 7_000_000, 2: 3_500_000}
    assert result.expenses[1].allocations == {1: 3_500_000, 2: 1_750_000}
    assert [v.unit_cost for v in result.lines.values()] == [805_000, 201_250]
    assert (
        result.expenses[0].revaluation_currency,
        result.expenses[0].revaluation_rate_scaled,
    ) == (None, None)
    assert (
        result.expenses[1].revaluation_currency,
        result.expenses[1].revaluation_rate_scaled,
    ) == ("CNY", 700_000)
    assert (result.goods_total, result.expenses_total, result.vat_credit_total) == (
        105_000_000,
        15_750_000,
        0,
    )


def test_reference_2_permutations():
    for lines in permutations([CostLine(1, 1, 0), CostLine(2, 1, 0), CostLine(3, 1, 0)]):
        result = calculate(lines, [CostExpense("delivery", 10_000, allocation_method="quantity")])
        assert result.expenses[0].allocations == {1: 3334, 2: 3333, 3: 3333}
        assert sum(result.expenses[0].allocations.values()) == 10_000


@pytest.mark.parametrize("vat", [False, True])
def test_reference_3_4(vat):
    result = calculate(expenses=[*EXPENSES, CostExpense("import_vat", 10_000_000)], vat=vat)
    assert result.expenses[2].allocations == {1: 6_666_667, 2: 3_333_333}
    assert [v.unit_cost for v in result.lines.values()] == (
        [805_000, 201_250] if vat else [871_667, 217_917]
    )
    assert result.expenses_total == (15_750_000 if vat else 25_750_000)
    assert result.vat_credit_total == (10_000_000 if vat else 0)
    assert result.expenses[2].is_vat_credit == vat
    assert result.expenses[2].revaluation_currency == (None if vat else "CNY")
    assert result.expenses[2].revaluation_rate_scaled == (None if vat else 700_000)


def test_reference_5():
    result = calculate([CostLine(1, 3, 3333)], [], rate=678_300)
    assert result.lines[1].goods_total == 678_232
    assert result.lines[1].unit_cost == 226_077
    assert result.lines[1].unit_cost * 3 == 678_231


def test_selected_and_manual_keep_zero_targets():
    expenses = [
        CostExpense("other", 10, allocation_method="selected", product_ids=(1, 3)),
        CostExpense("bank", 7, allocation_method="manual", manual=((2, 7), (3, 0))),
    ]
    result = calculate([CostLine(1, 1, 1), CostLine(2, 1, 100), CostLine(3, 1, 0)], expenses)
    assert result.expenses[0].allocations == {1: 10, 3: 0}
    assert result.expenses[1].allocations == {2: 7, 3: 0}


@pytest.mark.parametrize("method", ["amount", "selected"])
def test_zero_weight(method):
    with pytest.raises(ExpenseZeroWeightError) as exc:
        calculate(
            [CostLine(1, 1, 0)],
            [CostExpense("other", 1, allocation_method=method, product_ids=(1,))],
        )
    assert exc.value.params == {"index": 0}


def test_manual_sum_mismatch():
    with pytest.raises(ExpenseManualSumMismatchError) as exc:
        calculate(
            expenses=[
                *EXPENSES,
                CostExpense("other", 100, allocation_method="manual", manual=((1, 99),)),
            ]
        )
    assert exc.value.params == {"index": 2, "expected": 100, "actual": 99}


@pytest.mark.parametrize(
    "kind",
    ["delivery", "customs_duty", "antidumping_duty", "import_vat", "broker", "bank", "other"],
)
@pytest.mark.parametrize("expense_currency", ["KZT", "CNY", "USD"])
@pytest.mark.parametrize("vat", [False, True])
def test_revaluation(kind, expense_currency, vat):
    expense = CostExpense(
        kind,
        1,
        currency=expense_currency,
        rate_scaled=10_000 if expense_currency == "KZT" else 123_456,
    )
    result = calculate(expenses=[expense], vat=vat).expenses[0]
    if kind == "import_vat" and vat:
        expected = (None, None)
    elif expense_currency != "KZT":
        expected = (expense_currency, 123_456)
    elif kind in ("customs_duty", "antidumping_duty", "import_vat"):
        expected = ("CNY", 700_000)
    else:
        expected = (None, None)
    assert (result.revaluation_currency, result.revaluation_rate_scaled) == expected
    if expense_currency == "KZT":
        kzt = calculate(expenses=[expense], vat=vat, currency="KZT", rate=10_000).expenses[0]
        assert (kzt.revaluation_currency, kzt.revaluation_rate_scaled) == (None, None)


@pytest.mark.parametrize(
    "case", ["goods", "goods_sum", "expense", "expense_sum", "line_total", "unit_cost"]
)
def test_limits(case):
    lines, expenses, rate = [CostLine(1, 1, 0)], [], 10_000
    if case == "goods":
        lines, rate = [CostLine(1, 100_000, MAX_SALE_PRICE)], 10_000
    elif case == "goods_sum":
        lines = [CostLine(1, 10_000, MAX_SALE_PRICE), CostLine(2, 10_000, 1)]
    elif case == "expense":
        expenses = [
            CostExpense(
                "other", MAX_MONEY, currency="USD", rate_scaled=10_001, allocation_method="quantity"
            )
        ]
    elif case == "expense_sum":
        expenses = [CostExpense("other", n, allocation_method="quantity") for n in (MAX_MONEY, 1)]
    elif case == "line_total":
        lines, expenses = [CostLine(1, 10_000, MAX_SALE_PRICE)], [CostExpense("bank", 1)]
    else:
        lines, expenses = [CostLine(1, 1, MAX_SALE_PRICE)], [CostExpense("bank", 1)]
    with pytest.raises(AmountTooLargeError):
        calculate(lines, expenses, rate=rate, currency="KZT")


def test_random_1000_receipts():
    rng = Random(2601)
    kinds = [
        "delivery",
        "customs_duty",
        "antidumping_duty",
        "import_vat",
        "broker",
        "bank",
        "other",
    ]
    for _ in range(1000):
        lines = [
            CostLine(pid, rng.randint(1, 100), rng.choice([0, rng.randint(1, 100_000)]))
            for pid in range(1, rng.randint(1, 30) + 1)
        ]
        currency = rng.choice(["KZT", "CNY", "USD"])
        rate = 10_000 if currency == "KZT" else rng.randint(1, 1000) * 10 ** rng.randint(0, 4)
        goods = {
            line.product_id: round_half_up(line.qty * line.unit_price_minor * rate, 10_000)
            for line in lines
        }
        expenses = []
        for _ in range(rng.randint(0, 6)):
            cur = rng.choice(["KZT", "CNY", "USD"])
            scaled = 10_000 if cur == "KZT" else rng.randint(1, 1000) * 10 ** rng.randint(0, 4)
            amount = rng.randint(1, 100_000)
            total = round_half_up(amount * scaled, 10_000)
            method = rng.choice(["amount", "quantity", "selected", "manual"])
            targets = rng.sample([line.product_id for line in lines], rng.randint(1, len(lines)))
            if (
                method in ("amount", "selected")
                and sum(goods[p] for p in (targets if method == "selected" else goods)) == 0
            ):
                method = "quantity"
            cuts = sorted([0, total, *[rng.randint(0, total) for _ in range(len(targets) - 1)]])
            expense = CostExpense(
                rng.choice(kinds),
                amount,
                cur,
                scaled,
                method,
                tuple(targets) if method == "selected" else (),
                tuple((pid, cuts[i + 1] - cuts[i]) for i, pid in enumerate(targets))
                if method == "manual"
                else (),
            )
            expenses.append(expense)
        vat = rng.choice([False, True])
        result = calculate(lines, expenses, vat, rate, currency)
        for expense, cost in zip(expenses, result.expenses, strict=True):
            assert sum(cost.allocations.values()) == cost.amount_tiyn
            if expense.allocation_method != "manual":
                weights = {
                    line.product_id: line.qty
                    if expense.allocation_method == "quantity"
                    else goods[line.product_id]
                    for line in lines
                    if line.product_id in cost.allocations
                }
                weight_sum = sum(weights.values())
                assert all(
                    abs(value * weight_sum - cost.amount_tiyn * weights[pid]) < weight_sum
                    for pid, value in cost.allocations.items()
                )
        for line in lines:
            cost = result.lines[line.product_id]
            expected_s = sum(
                part.allocations.get(line.product_id, 0)
                for part in result.expenses
                if not part.is_vat_credit
            )
            expected_vat = sum(
                part.allocations.get(line.product_id, 0)
                for part in result.expenses
                if part.is_vat_credit
            )
            assert (cost.expenses_total, cost.vat_credit_total) == (expected_s, expected_vat)
            assert cost.unit_cost == round_half_up(cost.goods_total + expected_s, line.qty)
        rng.shuffle(lines)
        order = list(range(len(expenses)))
        rng.shuffle(order)
        shuffled = calculate(lines, [expenses[i] for i in order], vat, rate, currency)
        assert shuffled.lines == result.lines
        assert shuffled.expenses == [result.expenses[i] for i in order]


def test_allocation_sum():
    result = calculate(
        [CostLine(1, 1, 0), CostLine(2, 1, 0), CostLine(3, 1, 0)],
        [CostExpense("delivery", 10_000, allocation_method="quantity")],
    )
    assert sum(result.expenses[0].allocations.values()) == 10_000

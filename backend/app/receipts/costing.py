"""Receipt costing using integer arithmetic only; no database or network operations."""

from collections.abc import Sequence
from dataclasses import dataclass

from app.catalog.schemas import MAX_SALE_PRICE
from app.errors import AmountTooLargeError, ExpenseManualSumMismatchError, ExpenseZeroWeightError
from app.inventory.service import round_half_up
from app.schema_types import MAX_MONEY


@dataclass(frozen=True)
class CostLine:
    product_id: int
    qty: int
    unit_price_minor: int


@dataclass(frozen=True)
class CostExpense:
    kind: str
    amount_minor: int
    currency: str = "KZT"
    rate_scaled: int = 10_000
    allocation_method: str = "amount"
    product_ids: tuple[int, ...] = ()
    manual: tuple[tuple[int, int], ...] = ()


@dataclass(frozen=True)
class LineCost:
    goods_total: int
    expenses_total: int
    vat_credit_total: int
    unit_cost: int


@dataclass(frozen=True)
class ExpenseCost:
    amount_tiyn: int
    is_vat_credit: bool
    allocations: dict[int, int]
    revaluation_currency: str | None
    revaluation_rate_scaled: int | None


@dataclass(frozen=True)
class ReceiptCost:
    lines: dict[int, LineCost]
    # Correspond to input expenses, so validation indices and persistence keep their identity.
    expenses: list[ExpenseCost]
    goods_total: int
    expenses_total: int
    vat_credit_total: int


def _check_money(value: int) -> None:
    if value > MAX_MONEY:
        raise AmountTooLargeError()


def calculate_receipt_costs(
    lines: Sequence[CostLine],
    rate_scaled: int,
    currency: str,
    expenses: Sequence[CostExpense],
    vat_payer: bool,
) -> ReceiptCost:
    """Calculate validated document inputs; targets/duplicates are checked by input schemas."""
    goods = {
        line.product_id: round_half_up(line.qty * line.unit_price_minor * rate_scaled, 10_000)
        for line in lines
    }
    for value in goods.values():
        _check_money(value)
    goods_total = sum(goods.values())
    _check_money(goods_total)
    capitalized = dict.fromkeys(goods, 0)
    vat_credit = dict.fromkeys(goods, 0)
    expense_results = []
    expenses_sum = 0
    for index, expense in enumerate(expenses):
        amount = round_half_up(expense.amount_minor * expense.rate_scaled, 10_000)
        _check_money(amount)
        expenses_sum += amount
        _check_money(expenses_sum)
        if expense.allocation_method == "manual":
            allocations = dict(expense.manual)
            actual = sum(allocations.values())
            if actual != amount:
                raise ExpenseManualSumMismatchError(
                    params={"index": index, "expected": amount, "actual": actual}
                )
        else:
            weights = {
                line.product_id: line.qty
                if expense.allocation_method == "quantity"
                else goods[line.product_id]
                for line in lines
                if expense.allocation_method != "selected" or line.product_id in expense.product_ids
            }
            weight_sum = sum(weights.values())
            if weight_sum == 0:
                raise ExpenseZeroWeightError(params={"index": index})
            parts = {pid: divmod(amount * weight, weight_sum) for pid, weight in weights.items()}
            allocations = {pid: base for pid, (base, _) in parts.items()}
            left = amount - sum(allocations.values())
            ranked = sorted(parts, key=lambda pid: (-parts[pid][1], pid))
            for pid in ranked[:left]:
                allocations[pid] += 1
        is_vat_credit = expense.kind == "import_vat" and vat_payer
        target = vat_credit if is_vat_credit else capitalized
        for pid, value in allocations.items():
            target[pid] += value
        revaluation_currency = None
        revaluation_rate = None
        if not is_vat_credit:
            if expense.currency != "KZT":
                revaluation_currency, revaluation_rate = expense.currency, expense.rate_scaled
            elif currency != "KZT" and expense.kind in (
                "customs_duty",
                "antidumping_duty",
                "import_vat",
            ):
                revaluation_currency, revaluation_rate = currency, rate_scaled
        expense_results.append(
            ExpenseCost(amount, is_vat_credit, allocations, revaluation_currency, revaluation_rate)
        )
    line_results = {}
    for line in lines:
        pid = line.product_id
        total = goods[pid] + capitalized[pid]
        _check_money(total)
        unit_cost = round_half_up(total, line.qty)
        if unit_cost > MAX_SALE_PRICE:
            raise AmountTooLargeError()
        line_results[pid] = LineCost(goods[pid], capitalized[pid], vat_credit[pid], unit_cost)
    return ReceiptCost(
        line_results,
        expense_results,
        goods_total,
        sum(capitalized.values()),
        sum(vat_credit.values()),
    )

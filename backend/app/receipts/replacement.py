"""Today's replacement cost: exact fractions, no persistence or external I/O."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from fractions import Fraction

from app.inventory.service import round_half_up


@dataclass(frozen=True)
class ReplacementExpense:
    amount_tiyn: int
    revaluation_currency: str | None = None
    revaluation_rate_scaled: int | None = None
    is_vat_credit: bool = False


@dataclass(frozen=True)
class ReplacementCost:
    goods: Fraction
    revalued: Fraction
    fixed: Fraction
    unit_cost: int


def rounded(value: Fraction) -> int:
    return round_half_up(value.numerator, value.denominator)


def calculate_replacement(
    qty: int,
    price_minor: int,
    currency: str,
    expenses: Sequence[ReplacementExpense],
    rates: Mapping[str, int],
) -> ReplacementCost:
    goods = Fraction(qty * price_minor * (10_000 if currency == "KZT" else rates[currency]), 10_000)
    revalued = Fraction(0)
    fixed = Fraction(0)
    for expense in expenses:
        if expense.is_vat_credit or expense.amount_tiyn == 0:
            continue
        if expense.revaluation_currency is not None:
            revalued += Fraction(
                expense.amount_tiyn * rates[expense.revaluation_currency],
                expense.revaluation_rate_scaled,
            )
        else:
            fixed += expense.amount_tiyn
    total = (goods + revalued + fixed) / qty
    return ReplacementCost(goods / qty, revalued / qty, fixed / qty, rounded(total))


def markup_percent(sale_price: int, cost: int | None) -> int | None:
    if cost is None or cost == 0:
        return None
    difference = sale_price - cost
    return (1 if difference >= 0 else -1) * round_half_up(abs(100 * difference), cost)


def price_for_markup(cost: int, markup: int | None) -> int | None:
    if markup is None or markup < -100:
        return None
    return round_half_up(cost * (100 + markup), 100)


def suggested_price(buy_today: int, markup_then: int | None) -> int:
    base = price_for_markup(buy_today, markup_then) if markup_then is not None else buy_today
    return ((max(base if base is not None else buy_today, buy_today) + 999) // 1000) * 1000

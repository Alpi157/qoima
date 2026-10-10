from datetime import date, timedelta

import pytest

from app.reports import service
from app.returns.service import cancel_return
from tests.return_helpers import AT, make_sale, post_return


@pytest.mark.parametrize(
    "condition,cost,profit,loss",
    [
        ("good", 0, 0, 0),
        ("defective", 400, -400, 400),
    ],
)
def test_full_return_report(return_case, condition, cost, profit, loss):
    case = return_case
    sale = make_sale(case, paid=1000)
    post_return(case, sale, 10, condition, returned_at=AT + timedelta(days=1), refund_method="card")
    summary = service.summary(case.db, date(2026, 1, 10), date(2026, 1, 11))
    assert (summary.revenue, summary.cost, summary.profit) == (0, cost, profit)
    assert (summary.returns_total, summary.returns_count, summary.defect_loss) == (1000, 1, loss)
    assert summary.sales_count == 1 and summary.debt_given == 0
    assert summary.received.model_dump() == {"cash": 1000, "card": -1000, "total": 0}
    assert [day.revenue for day in summary.days] == [1000, -1000]
    assert [day.profit for day in summary.days] == [600, -600 if condition == "good" else -1000]
    product = service.products(case.db, date(2026, 1, 10), date(2026, 1, 11), 50, 0).items[0]
    assert (product.qty, product.revenue, product.cost, product.profit) == (0, 0, cost, profit)
    customer = service.customers(case.db, date(2026, 1, 10), date(2026, 1, 11), 50, 0).items[0]
    assert (customer.sales_count, customer.revenue, customer.profit) == (1, 0, profit)
    only_return = service.summary(case.db, date(2026, 1, 11), date(2026, 1, 11))
    assert only_return.sales_count == 0
    assert only_return.revenue == -1000
    assert (
        service.customers(case.db, date(2026, 1, 11), date(2026, 1, 11), 50, 0).items[0].sales_count
        == 0
    )


@pytest.mark.parametrize("condition", ["good", "defective"])
def test_unknown_cost_returns_and_cancelled_reports(return_case, condition):
    from app.inventory.service import MovementIn, post_movements
    from tests.factories import create_product

    case = return_case
    product = create_product(case.db)
    post_movements(case.db, [MovementIn(product.id, 10, "adjustment")], case.user)
    case.product = product.id
    sale = make_sale(case, customer=False, paid=1000)
    document = post_return(case, sale, 10, condition, returned_at=AT + timedelta(days=1))
    summary = service.summary(case.db, date(2026, 1, 10), date(2026, 1, 11))
    assert (
        summary.revenue,
        summary.profit,
        summary.cost,
        summary.revenue_unknown_cost,
        summary.defect_loss,
    ) == (0, 0, 0, 0, 0)
    assert summary.received.total == 0
    customer = service.customers(case.db, date(2026, 1, 11), date(2026, 1, 11), 50, 0).items[0]
    assert customer.customer_id is None and customer.revenue_unknown_cost == -1000
    cancel_return(case.db, document.id, "Ошибочный возврат", case.user)
    summary = service.summary(case.db, date(2026, 1, 10), date(2026, 1, 11))
    assert summary.revenue_unknown_cost == 1000
    assert (summary.returns_count, summary.returns_total, summary.defect_loss) == (0, 0, 0)
    assert summary.received.total == 1000


def test_returns_use_almaty_day_and_do_not_multiply_refund(return_case):
    case = return_case
    sale = make_sale(case, paid=1000)
    post_return(case, sale, 2, returned_at="2026-01-10T18:59:59Z")
    post_return(case, sale, 3, "defective", returned_at="2026-01-10T19:00:00Z")
    jan10 = service.summary(case.db, date(2026, 1, 10), date(2026, 1, 10))
    jan11 = service.summary(case.db, date(2026, 1, 11), date(2026, 1, 11))
    assert (jan10.revenue, jan10.profit, jan10.received.cash, jan10.returns_total) == (
        800,
        480,
        800,
        200,
    )
    assert (jan11.revenue, jan11.profit, jan11.received.cash, jan11.defect_loss) == (
        -300,
        -300,
        -300,
        120,
    )

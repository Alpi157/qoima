import uuid
from datetime import UTC, datetime

from app.customers import service as customers
from app.returns import service as returns
from app.returns.schemas import ReturnCreate, ReturnLineIn
from app.sales import service as sales
from app.sales.schemas import SaleCreate, SaleLineIn

AT = datetime(2026, 1, 10, 10, tzinfo=UTC)


def make_sale(case, qty=10, paid=0, customer=True, at=AT, price=100):
    return sales.post_sale(
        case.db,
        SaleCreate(
            request_id=uuid.uuid4(),
            customer_id=case.customer if customer else None,
            paid_amount=paid,
            sold_at=at,
            lines=[SaleLineIn(product_id=case.product, qty=qty, unit_price=price)],
        ),
        case.user,
    )[0]


def return_data(sale, qty=1, condition="good", **kwargs):
    return ReturnCreate(
        request_id=kwargs.pop("request_id", uuid.uuid4()),
        sale_id=sale.id,
        lines=[ReturnLineIn(sale_line_id=sale.lines[0].id, qty=qty, condition=condition)],
        **kwargs,
    )


def post_return(case, sale, qty=1, condition="good", **kwargs):
    return returns.post_return(case.db, return_data(sale, qty, condition, **kwargs), case.user)[0]


def invariant(case):
    page = sales.list_sales(case.db, None, None, case.customer, "posted", 200, 0)
    assert sum(item.outstanding for item in page.items) == max(
        customers.current_debt(case.db, case.customer), 0
    )
    for item in page.items:
        detail = sales.get_sale(case.db, item.id)
        assert (detail.outstanding, detail.payment_status) == (
            item.outstanding,
            item.payment_status,
        )
    return {item.id: item for item in page.items}

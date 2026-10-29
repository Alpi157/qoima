from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.attention.models import AttentionDismissal
from app.attention.schemas import KINDS, AttentionOut, HiddenUntil, Thresholds
from app.buy_today.service import evaluate_products
from app.catalog.models import Product
from app.customers.models import Customer
from app.customers.service import debt_source, fifo_debt_source
from app.db_utils import LOCAL_TZ
from app.debt_adjustments.models import CustomerDebtAdjustment
from app.inventory.models import MAIN_WAREHOUSE_CODE, StockBalance, StockMovement, Warehouse
from app.inventory.service import round_half_up
from app.rates import service as rates_service
from app.rates.service import SessionFactory
from app.receipts.models import Receipt, ReceiptLine
from app.reports.service import _sales_source, adjustment_conditions
from app.returns.models import SaleReturn, SaleReturnLine
from app.sales.models import Sale, SaleLine
from app.settings.service import get_business_settings


def local_date(moment):
    return moment.astimezone(ZoneInfo(LOCAL_TZ)).date()


def hide(db: Session, key: str, user_id: int) -> HiddenUntil:
    until = rates_service.today_local() + timedelta(days=7)
    db.execute(
        insert(AttentionDismissal)
        .values(key=key, hidden_until=until, created_by=user_id)
        .on_conflict_do_update(
            index_elements=[AttentionDismissal.key],
            set_={"hidden_until": until, "updated_at": func.now()},
        )
    )
    db.commit()
    return HiddenUntil(key=key, hidden_until=until)


def unhide(db: Session, key: str) -> None:
    db.execute(delete(AttentionDismissal).where(AttentionDismissal.key == key))
    db.commit()


def attention(db: Session, *, session_factory: SessionFactory) -> AttentionOut:
    today = rates_service.today_local()
    start = today - timedelta(days=29)
    settings = get_business_settings(db, read_only=True)
    thresholds = Thresholds(
        **{n: getattr(settings, n) for n in Thresholds.model_fields if n.startswith("attention_")}
    )
    values, _, rates = evaluate_products(db, None, session_factory=session_factory)
    main = select(Warehouse.id).where(Warehouse.code == MAIN_WAREHOUSE_CODE).scalar_subquery()
    products = {
        p.id: (p, qty or 0, avg)
        for p, qty, avg in db.execute(
            select(Product, StockBalance.qty, StockBalance.avg_cost).outerjoin(
                StockBalance,
                (StockBalance.product_id == Product.id) & (StockBalance.warehouse_id == main),
            )
        )
    }
    sales = {s.id: s for s in db.scalars(select(Sale).where(Sale.status == "posted"))}
    lines = db.scalars(select(SaleLine).join(Sale).where(Sale.status == "posted")).all()
    returned = defaultdict(int)
    return_facts = []
    for line, at in db.execute(
        select(SaleReturnLine, SaleReturn.returned_at)
        .join(SaleReturn)
        .where(SaleReturn.status == "posted")
    ):
        returned[line.sale_line_id] += line.qty
        return_facts.append((line.product_id, local_date(at), line.qty))
    history = {}
    last_sale = {}

    def remember(pid, day):
        history[pid] = min(history.get(pid, day), day)

    for pid, at in db.execute(
        select(ReceiptLine.product_id, Receipt.received_at)
        .join(Receipt)
        .where(Receipt.status == "posted")
    ):
        remember(pid, local_date(at))
    for pid, at in db.execute(
        select(StockMovement.product_id, func.min(StockMovement.created_at))
        .where(StockMovement.kind == "adjustment")
        .group_by(StockMovement.product_id)
    ):
        remember(pid, local_date(at))
    quantities = defaultdict(int)
    for line in lines:
        day = local_date(sales[line.sale_id].sold_at)
        remember(line.product_id, day)
        last_sale[line.product_id] = max(last_sale.get(line.product_id, day), day)
    for line in lines:
        day = local_date(sales[line.sale_id].sold_at)
        if max(today - timedelta(days=59), history[line.product_id]) <= day <= today:
            quantities[line.product_id] += line.qty
    sold_products = set(quantities)
    for pid, day, qty in return_facts:
        if pid in history and max(today - timedelta(days=59), history[pid]) <= day <= today:
            quantities[pid] -= qty
    signals = []
    pending = defaultdict(list)

    def add(kind, obj, amount, action, params):
        signals.append(
            dict(
                key=f"{kind}:{obj}",
                kind=kind,
                object=obj,
                amount=amount,
                action=action,
                params=params,
            )
        )

    def identity(p):
        return dict(product_id=p.id, article=p.article, name=p.name, unit=p.unit)

    for pid, (p, stock, avg) in products.items():
        obj = f"product:{pid}"
        v = values.get(pid)
        if (
            stock > 0
            and not p.is_archived
            and p.sale_price > 0
            and v is not None
            and v.buy_today is not None
        ):
            common = dict(
                **identity(p),
                qty=stock,
                sale_price=p.sale_price,
                buy_today=v.buy_today,
                markup_then=v.markup_then,
                suggested_price=v.suggested_price,
                basis=v.basis,
                basis_date=v.basis_date,
                currency=v.currency,
                rates=v.rates,
            )
            if p.sale_price < v.buy_today:
                add(
                    "below_replacement",
                    obj,
                    (v.buy_today - p.sale_price) * stock,
                    "change_price",
                    dict(
                        **common,
                        shortage_per_unit=v.buy_today - p.sale_price,
                        goods_today=v.goods_today,
                        expenses_revalued=v.expenses_revalued,
                        expenses_fixed=v.expenses_fixed,
                    ),
                )
            elif v.markup_then is not None and v.markup_now is not None:
                drop = v.markup_then - v.markup_now
                amount = (v.price_to_keep_markup - p.sale_price) * stock
                if drop > settings.attention_markup_drop_points and amount > 0:
                    add(
                        "markup_drop",
                        obj,
                        amount,
                        "change_price",
                        dict(
                            **common,
                            cost_then=v.cost_then,
                            markup_now=v.markup_now,
                            drop_points=drop,
                            price_to_keep_markup=v.price_to_keep_markup,
                        ),
                    )
        if pid not in history:
            continue
        age = (today - history[pid]).days
        last = last_sale.get(pid)
        if (
            stock > 0
            and avg is not None
            and avg > 0
            and (last is None or last < today - timedelta(days=settings.attention_frozen_days - 1))
        ):
            if age < settings.attention_frozen_days:
                pending["frozen_stock"].append(settings.attention_frozen_days - age)
            else:
                add(
                    "frozen_stock",
                    obj,
                    stock * avg,
                    "open_product",
                    dict(
                        **identity(p),
                        qty=stock,
                        avg_cost=avg,
                        is_archived=p.is_archived,
                        history_start=history[pid],
                        last_sale_date=last,
                        days_without_sales=(today - last).days if last else age,
                    ),
                )
        sold = quantities[pid]
        if not p.is_archived and pid in sold_products and sold > 0:
            runway = settings.attention_runway_days
            if age < runway:
                pending["running_out"].append(runway - age)
            else:
                days = min(60, age + 1)
                shortage = max(0, runway * sold - stock * days)
                low = p.min_qty is not None and stock <= p.min_qty
                if shortage > 0 or low:
                    add(
                        "running_out",
                        obj,
                        round_half_up(shortage * p.sale_price, days),
                        "open_product",
                        dict(
                            **identity(p),
                            stock=stock,
                            min_qty=p.min_qty,
                            sold_qty=sold,
                            days=days,
                            days_left=stock * days // sold,
                            runway_days=runway,
                            order_qty=max(0, (60 * sold + days - 1) // days - stock),
                            sale_price=p.sale_price,
                            trigger="both" if low and shortage else "min_qty" if low else "runway",
                            history_start=history[pid],
                        ),
                    )
    customers = {c.id: c for c in db.scalars(select(Customer))}
    debts = dict(db.execute(select(debt_source())).all())
    adjustments = {
        a.id: a
        for a in db.scalars(
            select(CustomerDebtAdjustment).where(CustomerDebtAdjustment.status == "posted")
        )
    }
    positions = defaultdict(list)
    for row in db.execute(select(fifo_debt_source())).mappings():
        if row["outstanding"] > 0:
            doc = sales[row["id"]] if row["kind"] == "sale" else adjustments[row["id"]]
            day = local_date(doc.sold_at if row["kind"] == "sale" else doc.adjusted_at)
            positions[row["customer_id"]].append(
                (
                    day,
                    row["kind"],
                    doc.number,
                    row["outstanding"],
                    doc.sold_at if row["kind"] == "sale" else doc.adjusted_at,
                    doc.id,
                )
            )
    for cid, items in positions.items():
        old = [i for i in items if (today - i[0]).days > settings.attention_debt_days]
        if old:
            first = min(old, key=lambda item: (item[4], item[1], item[5]))
            amount = sum(i[3] for i in old)
            c = customers[cid]
            add(
                "old_debt",
                f"customer:{cid}",
                amount,
                "open_customer",
                dict(
                    customer_id=cid,
                    name=c.name,
                    phone=c.phone,
                    total_debt=debts[cid],
                    old_amount=amount,
                    old_positions_count=len(old),
                    oldest_date=first[0],
                    oldest_kind=first[1],
                    oldest_number=first[2],
                    age_days=(today - first[0]).days,
                ),
            )
    losing = defaultdict(list)
    unknown = []
    for line in lines:
        doc = sales[line.sale_id]
        qty = line.qty - returned[line.id]
        if start <= local_date(doc.sold_at) <= today and qty > 0:
            if line.unit_cost is None:
                unknown.append((line, qty))
            elif line.unit_price < line.unit_cost:
                losing[line.product_id].append((line, qty))
    for pid, rows in losing.items():
        rows.sort(key=lambda r: (sales[r[0].sale_id].sold_at, r[0].id), reverse=True)
        amount = sum((line.unit_cost - line.unit_price) * q for line, q in rows)
        add(
            "loss_sales",
            f"product:{pid}",
            amount,
            "show_sales",
            dict(
                **identity(products[pid][0]),
                lines_count=len(rows),
                qty=sum(q for _, q in rows),
                loss=amount,
                sales=[
                    dict(
                        sale_id=line.sale_id,
                        number=sales[line.sale_id].number,
                        sold_at=sales[line.sale_id].sold_at,
                        qty=q,
                        unit_price=line.unit_price,
                        unit_cost=line.unit_cost,
                    )
                    for line, q in rows[:20]
                ],
            ),
        )
    source = _sales_source(start, today)
    facts = db.execute(select(source)).mappings().all()
    revenue = sum(int(r["revenue"]) for r in facts)
    profit = sum(int(r["profit"]) for r in facts)
    discount = sum(int(r["discount_total"]) for r in facts)
    discounts = defaultdict(int)
    losses = defaultdict(lambda: [0, 0, 0])
    for r in facts:
        discounts[r["sale_id"]] += int(r["discount_total"])
        losses[r["product_id"]][0] += int(r["defect_loss"])
    for pid, qty, cost in db.execute(
        select(StockMovement.product_id, StockMovement.qty, StockMovement.unit_cost).where(
            *adjustment_conditions(start, today, settings.opening_balance_date)
        )
    ):
        if cost is not None:
            losses[pid][1 if qty < 0 else 2] += abs(qty) * cost
    if discount > 0 and (
        profit <= 0 or discount * 100 > settings.attention_discount_percent * profit
    ):
        top = sorted(
            (
                sid
                for sid, d in discounts.items()
                if d > 0 and sid in sales and start <= local_date(sales[sid].sold_at) <= today
            ),
            key=lambda sid: (-discounts[sid], sid),
        )[:10]
        add(
            "discounts",
            "business",
            discount,
            "show_sales",
            dict(
                discount_total=discount,
                profit=profit,
                percent=round_half_up(discount * 100, profit) if profit > 0 else None,
                threshold_percent=settings.attention_discount_percent,
                window_days=30,
                sales=[
                    dict(
                        sale_id=sid,
                        number=sales[sid].number,
                        sold_at=sales[sid].sold_at,
                        customer_name=customers[sales[sid].customer_id].name
                        if sales[sid].customer_id
                        else None,
                        discount=discounts[sid],
                    )
                    for sid in top
                ],
            ),
        )
    defect, writeoff, surplus = (sum(v[i] for v in losses.values()) for i in range(3))
    loss = defect + writeoff - surplus
    if loss > 0 and (revenue <= 0 or loss * 100 > settings.attention_loss_percent * revenue):
        top = sorted(
            (pid for pid, v in losses.items() if v[0] + v[1] - v[2] > 0),
            key=lambda pid: (-(losses[pid][0] + losses[pid][1] - losses[pid][2]), pid),
        )[:10]
        add(
            "defects_write_offs",
            "business",
            loss,
            "show_products",
            dict(
                defect_loss=defect,
                write_off_value=writeoff,
                surplus_value=surplus,
                losses=loss,
                revenue=revenue,
                percent=round_half_up(loss * 100, revenue) if revenue > 0 else None,
                threshold_percent=settings.attention_loss_percent,
                window_days=30,
                products=[
                    dict(
                        product_id=pid,
                        article=products[pid][0].article,
                        name=products[pid][0].name,
                        defect_loss=losses[pid][0],
                        write_off_value=losses[pid][1],
                        surplus_value=losses[pid][2],
                        net=losses[pid][0] + losses[pid][1] - losses[pid][2],
                    )
                    for pid in top
                ],
            ),
        )
    missing = sorted((pid for pid, (_, q, a) in products.items() if q > 0 and a is None))
    if missing:
        add(
            "incomplete_data",
            "stock",
            sum(products[pid][0].sale_price * products[pid][1] for pid in missing),
            "show_products",
            dict(
                products_count=len(missing),
                products=[
                    dict(
                        product_id=pid,
                        article=products[pid][0].article,
                        name=products[pid][0].name,
                        qty=products[pid][1],
                    )
                    for pid in missing[:20]
                ],
            ),
        )
    amount = sum(line.unit_price * q for line, q in unknown)
    if amount > 0:
        ids = sorted(
            {line.sale_id for line, _ in unknown},
            key=lambda sid: (sales[sid].sold_at, sid),
            reverse=True,
        )[:20]
        add(
            "incomplete_data",
            "sales",
            amount,
            "show_sales",
            dict(
                lines_count=len(unknown),
                revenue=amount,
                sales=[
                    dict(sale_id=sid, number=sales[sid].number, sold_at=sales[sid].sold_at)
                    for sid in ids
                ],
            ),
        )
    for rate in rates:
        if rate.rate is None or rate.exact is not True:
            ids = [
                pid
                for pid, v in values.items()
                if any(r.currency == rate.currency for r in v.rates)
            ]
            if ids:
                add(
                    "incomplete_data",
                    f"rate:{rate.currency}",
                    sum(products[pid][1] * (products[pid][2] or 0) for pid in ids),
                    "show_products",
                    dict(
                        currency=rate.currency,
                        rate=rate.rate,
                        rate_date=rate.rate_date,
                        products_count=len(ids),
                    ),
                )
    signals.sort(key=lambda s: (-s["amount"], KINDS.index(s["kind"]), s["key"]))
    dismissals = {
        d.key: d.hidden_until
        for d in db.scalars(
            select(AttentionDismissal).where(AttentionDismissal.hidden_until > today)
        )
    }
    hidden = [
        dict(key=s["key"], kind=s["kind"], amount=s["amount"], hidden_until=dismissals[s["key"]])
        for s in signals
        if s["key"] in dismissals
    ]
    return AttentionOut(
        today=today,
        thresholds=thresholds,
        signals=[s for s in signals if s["key"] not in dismissals],
        hidden=hidden,
        pending=[
            dict(
                kind=k,
                products_count=len(v),
                days_left=min(v),
                ready_on=today + timedelta(days=min(v)),
            )
            for k, v in sorted(pending.items())
        ],
        rates=rates,
    )

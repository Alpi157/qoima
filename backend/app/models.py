"""Imports every model so Base.metadata is complete (used by Alembic)."""

from app.auth.models import User, UserSession
from app.catalog.models import Product
from app.customers.models import Customer
from app.debt_adjustments.models import CustomerDebtAdjustment
from app.inventory.models import StockBalance, StockMovement, Warehouse
from app.numbering import DocumentCounter
from app.payments.models import CustomerPayment
from app.price_quotes.models import ProductPriceQuote
from app.rates.models import ExchangeRate
from app.receipts.models import Receipt, ReceiptExpense, ReceiptExpenseAllocation, ReceiptLine
from app.returns.models import SaleReturn, SaleReturnLine
from app.sales.models import Sale, SaleLine
from app.settings.models import BusinessSettings

__all__ = [
    "BusinessSettings",
    "Customer",
    "CustomerPayment",
    "CustomerDebtAdjustment",
    "DocumentCounter",
    "ExchangeRate",
    "Product",
    "ProductPriceQuote",
    "Receipt",
    "ReceiptExpense",
    "ReceiptExpenseAllocation",
    "ReceiptLine",
    "Sale",
    "SaleLine",
    "SaleReturn",
    "SaleReturnLine",
    "StockBalance",
    "StockMovement",
    "User",
    "UserSession",
    "Warehouse",
]

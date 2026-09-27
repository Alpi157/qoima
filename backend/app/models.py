"""Imports every model so Base.metadata is complete (used by Alembic)."""

from app.auth.models import User, UserSession
from app.catalog.models import Product
from app.customers.models import Customer
from app.inventory.models import StockBalance, StockMovement, Warehouse
from app.numbering import DocumentCounter
from app.receipts.models import Receipt, ReceiptLine
from app.sales.models import Sale, SaleLine
from app.settings.models import BusinessSettings

__all__ = [
    "BusinessSettings",
    "Customer",
    "DocumentCounter",
    "Product",
    "Receipt",
    "ReceiptLine",
    "Sale",
    "SaleLine",
    "StockBalance",
    "StockMovement",
    "User",
    "UserSession",
    "Warehouse",
]

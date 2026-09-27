"""Gapless document numbers.

A sequence is not transactional: a rolled-back document would burn its number. The counter row
is updated in the document's own transaction instead, so a rollback returns the number, and the
row lock makes concurrent postings of the same document type take numbers one after another.
"""

from typing import Literal

from sqlalchemy import BigInteger, CheckConstraint, Text, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import Base

NumberedDocType = Literal["receipt", "sale"]


class DocumentCounter(Base):
    __tablename__ = "document_counters"
    __table_args__ = (
        CheckConstraint("doc_type IN ('receipt', 'sale')", name="doc_type_valid"),
        CheckConstraint("last_number >= 0", name="last_number_non_negative"),
    )

    doc_type: Mapped[str] = mapped_column(Text, primary_key=True)
    last_number: Mapped[int] = mapped_column(BigInteger)


def next_number(db: Session, doc_type: NumberedDocType) -> int:
    """Take the next number for a document. Never commits: the caller owns the transaction."""
    return db.execute(
        update(DocumentCounter)
        .where(DocumentCounter.doc_type == doc_type)
        .values(last_number=DocumentCounter.last_number + 1)
        .returning(DocumentCounter.last_number)
    ).scalar_one()

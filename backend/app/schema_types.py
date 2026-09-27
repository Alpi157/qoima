from pydantic import BeforeValidator, StringConstraints

# Trimmed, non-empty string: use as Annotated[str, NonEmpty, MaxLen(n)].
NonEmpty = StringConstraints(strip_whitespace=True, min_length=1)


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value


# Blank string becomes None: use as Annotated[Annotated[str, Trimmed, ...] | None, BlankToNone].
BlankToNone = BeforeValidator(_blank_to_none)
Trimmed = StringConstraints(strip_whitespace=True)


def reject_explicit_nulls(data: object, fields: tuple[str, ...]) -> object:
    """For PATCH bodies: a field may be omitted, but must not be sent as null."""
    if isinstance(data, dict):
        nulls = [f for f in fields if f in data and data[f] is None]
        if nulls:
            raise ValueError(f"Поле не может быть пустым: {', '.join(nulls)}")
    return data

LIKE_ESCAPE = "\\"


def escape_like(value: str) -> str:
    """Escape LIKE wildcards so the value is matched literally (use with ESCAPE LIKE_ESCAPE)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def contains_pattern(value: str) -> str:
    return f"%{escape_like(value)}%"

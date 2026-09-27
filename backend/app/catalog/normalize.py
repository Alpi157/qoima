import re
import unicodedata

from app.errors import InvalidArticleError

_CYRILLIC_LOOKALIKES = str.maketrans("АВЕЁКМНОРСТУХ", "ABEEKMHOPCTYX")
_DISALLOWED = re.compile(r"[^A-Z0-9А-ЯЁ]")


def normalize_article(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).upper().translate(_CYRILLIC_LOOKALIKES)
    normalized = _DISALLOWED.sub("", normalized)
    if not normalized:
        raise InvalidArticleError("Артикул не может быть пустым")
    return normalized

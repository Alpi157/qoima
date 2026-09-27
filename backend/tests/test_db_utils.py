from app.db_utils import contains_pattern, escape_like


def test_escape_like() -> None:
    assert escape_like("10%_a\\b") == "10\\%\\_a\\\\b"


def test_contains_pattern() -> None:
    assert contains_pattern("5%") == "%5\\%%"

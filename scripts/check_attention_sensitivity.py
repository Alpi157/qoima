"""Run each attention mutation in a fresh process without changing source files.

Run from backend: uv run python ../scripts/check_attention_sensitivity.py
"""

import inspect
import subprocess
import sys
from pathlib import Path

CASES = {
    "markup_boundary": (
        "app.attention.service",
        "attention",
        "drop > settings.attention_markup_drop_points",
        "drop >= settings.attention_markup_drop_points",
        "reference_7_8",
    ),
    "document_history": (
        "app.attention.service",
        "attention",
        "remember(pid, local_date(at))",
        "remember(pid, today)",
        "backdated_history",
    ),
    "surplus": (
        "app.attention.service",
        "attention",
        "loss = defect + writeoff - surplus",
        "loss = defect + writeoff",
        "mixup_no_loss",
    ),
    "returned_qty": (
        "app.attention.service",
        "attention",
        "qty = line.qty - returned[line.id]",
        "qty = line.qty",
        "loss_returns",
    ),
    "opening_summary": (
        "app.reports.service",
        "summary",
        "adjustment_conditions(date_from, date_to, settings.opening_balance_date)",
        "adjustment_conditions(date_from, date_to, None)",
        "opening_date_reports",
    ),
    "exclusive_price": (
        "app.attention.service",
        "attention",
        "elif v.markup_then is not None",
        "if v.markup_then is not None",
        "reference_7_8",
    ),
    "hidden_expiry": (
        "app.attention.service",
        "attention",
        "AttentionDismissal.hidden_until > today",
        "AttentionDismissal.hidden_until.is_not(None)",
        "backdated_history",
    ),
    "suggested_rounding": (
        "app.receipts.replacement",
        "suggested_price",
        "((max(base if base is not None else buy_today, buy_today) + 999) // 1000) * 1000",
        "round_half_up(max(base if base is not None else buy_today, buy_today), 1000) * 1000",
        "suggested_price_below_half_interval or reference_7_8",
    ),
}


def child(name):
    import importlib
    import pytest

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    module_name, symbol, before, after, test = CASES[name]
    module = importlib.import_module(module_name)
    source = inspect.getsource(getattr(module, symbol))
    if before not in source:
        raise RuntimeError(f"Mutation target missing: {name}")
    exec(compile(source.replace(before, after, 1), f"<mutation:{name}>", "exec"), module.__dict__)
    if symbol == "suggested_price":
        import app.buy_today.service

        app.buy_today.service.suggested_price = module.suggested_price
    return pytest.main(["-q", "tests/test_attention.py", "-k", test])


def main():
    if len(sys.argv) == 2:
        return child(sys.argv[1])
    failed = False
    for name in CASES:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), name], capture_output=True, text=True
        )
        path = Path("/tmp") / f"qoima30a-mutation-{name}.log"
        path.write_text(result.stdout + result.stderr)
        detected = result.returncode == 1 and " failed" in result.stdout
        print(f"{name}: {'detected' if detected else 'ERROR'} ({path})", flush=True)
        failed |= not detected
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())

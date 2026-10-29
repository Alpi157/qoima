"""Measure twenty authenticated attention requests against the local demo API only."""

import http.cookiejar
import json
import os
import time
import urllib.request
from pathlib import Path


def main():
    base = "http://127.0.0.1:8011"
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    request = urllib.request.Request(
        base + "/api/auth/login",
        data=json.dumps({"username": "demo", "password": os.environ["DEMO_PASSWORD"]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with opener.open(request, timeout=10) as response:
        assert response.status == 200
    durations = []
    for _ in range(20):
        started = time.perf_counter_ns()
        with opener.open(base + "/api/attention", timeout=10) as response:
            data = json.load(response)
        durations.append((time.perf_counter_ns() - started) // 1000)
    result = {
        "requests": 20,
        "median_us": sum(sorted(durations)[9:11]) // 2,
        "maximum_us": max(durations),
        "signals": [
            {"key": s["key"], "kind": s["kind"], "amount": s["amount"]} for s in data["signals"]
        ],
        "pending": data["pending"],
    }
    path = Path(__file__).resolve().parents[1] / "review" / "attention-benchmark.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if max(durations) >= 1_000_000:
        raise SystemExit("Attention exceeded one second")


if __name__ == "__main__":
    main()

import argparse
import json
import time
from collections.abc import Callable, Mapping
from dataclasses import replace
from typing import Any
from urllib.request import Request, urlopen

from .generator import generate_scale_dataset
from .transport import to_jsonable


HttpBenchmarkMetrics = dict[str, int | str]
HttpRequest = Callable[[str, Mapping[str, Any], int], Mapping[str, Any]]


def benchmark_http_schedule(
    exam_count: int,
    seed: int,
    time_limit: int,
    base_url: str,
    request: HttpRequest | None = None,
) -> HttpBenchmarkMetrics:
    schedule_input = generate_scale_dataset(exam_count=exam_count, seed=seed)
    schedule_input = replace(
        schedule_input,
        constraint_profile=replace(
            schedule_input.constraint_profile,
            time_limit_seconds=time_limit,
        ),
    )
    payload = to_jsonable(schedule_input)
    normalized_base_url = base_url.rstrip("/")
    started_at = time.perf_counter_ns()
    result = (request or _post_solve)(
        normalized_base_url,
        payload,
        time_limit + 5,
    )
    http_elapsed_ms = round((time.perf_counter_ns() - started_at) / 1_000_000)
    statistics = result["statistics"]
    assignments = result["assignments"]
    conflicts = result["conflicts"]
    if not isinstance(statistics, Mapping):
        raise ValueError("Scheduler HTTP result statistics must be an object.")
    if not isinstance(assignments, list) or not isinstance(conflicts, list):
        raise ValueError("Scheduler HTTP result collections must be arrays.")
    solver_elapsed_ms = statistics["elapsed_ms"]
    status = statistics["status"]
    if not isinstance(solver_elapsed_ms, int) or not isinstance(status, str):
        raise ValueError("Scheduler HTTP result statistics are invalid.")

    return {
        "exam_count": exam_count,
        "status": status,
        "solver_elapsed_ms": solver_elapsed_ms,
        "http_elapsed_ms": http_elapsed_ms,
        "http_overhead_ms": max(0, http_elapsed_ms - solver_elapsed_ms),
        "assignment_count": len(assignments),
        "conflict_count": len(conflicts),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark the ExamForge scheduler HTTP boundary."
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--sizes", nargs="+", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--time-limit", type=int, required=True)
    args = parser.parse_args(argv)

    all_successful = True
    for exam_count in args.sizes:
        metrics = benchmark_http_schedule(
            exam_count=exam_count,
            seed=args.seed,
            time_limit=args.time_limit,
            base_url=args.base_url,
        )
        print(json.dumps(metrics, ensure_ascii=False, sort_keys=True))
        all_successful = all_successful and (
            metrics["status"] == "feasible"
            and metrics["assignment_count"] == exam_count
            and metrics["conflict_count"] == 0
        )
    return 0 if all_successful else 1


def _post_solve(
    base_url: str,
    payload: Mapping[str, Any],
    timeout_seconds: int,
) -> Mapping[str, Any]:
    http_request = Request(
        f"{base_url}/solve",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-request-id": "scheduler-http-benchmark",
        },
        method="POST",
    )
    with urlopen(http_request, timeout=timeout_seconds) as response:
        result = json.load(response)
    if not isinstance(result, Mapping):
        raise ValueError("Scheduler HTTP result must be an object.")
    return result


if __name__ == "__main__":
    raise SystemExit(main())

import argparse
import json
from collections import Counter
from dataclasses import replace

from .generator import generate_scale_dataset
from .models import SolveStatus
from .solver import solve_schedule


BenchmarkMetrics = dict[str, int | str]


def benchmark_schedule(
    exam_count: int,
    seed: int,
    time_limit: int,
) -> BenchmarkMetrics:
    metrics, _ = _run_benchmark(exam_count, seed, time_limit)
    return metrics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run ExamForge scheduler benchmarks.")
    parser.add_argument("--sizes", nargs="+", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--time-limit", type=int, required=True)
    args = parser.parse_args(argv)

    all_successful = True
    for exam_count in args.sizes:
        metrics, successful = _run_benchmark(
            exam_count,
            args.seed,
            args.time_limit,
        )
        print(json.dumps(metrics, ensure_ascii=False, sort_keys=True))
        all_successful = all_successful and successful
    return 0 if all_successful else 1


def _run_benchmark(
    exam_count: int,
    seed: int,
    time_limit: int,
) -> tuple[BenchmarkMetrics, bool]:
    schedule_input = generate_scale_dataset(exam_count=exam_count, seed=seed)
    schedule_input = replace(
        schedule_input,
        constraint_profile=replace(
            schedule_input.constraint_profile,
            time_limit_seconds=time_limit,
        ),
    )
    result = solve_schedule(schedule_input)
    workload = Counter(
        teacher_id
        for assignment in result.assignments
        for teacher_id in assignment.teacher_ids
    )
    teacher_loads = [
        workload.get(teacher.id, 0) for teacher in schedule_input.teachers
    ]
    metrics: BenchmarkMetrics = {
        "exam_count": exam_count,
        "status": result.statistics.status.value,
        "elapsed_ms": result.statistics.elapsed_ms,
        "attempted_assignments": result.statistics.attempted_assignments,
        "score": result.score.total_score,
        "conflict_count": len(result.conflicts),
        "teacher_max_load": max(teacher_loads, default=0),
        "teacher_load_spread": (
            max(teacher_loads) - min(teacher_loads) if teacher_loads else 0
        ),
    }
    successful = (
        result.statistics.status == SolveStatus.FEASIBLE
        and len(result.assignments) == exam_count
        and not result.conflicts
        and result.score.hard_violation_count == 0
    )
    return metrics, successful


if __name__ == "__main__":
    raise SystemExit(main())

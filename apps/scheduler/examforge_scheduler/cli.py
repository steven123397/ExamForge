import argparse
import json
import sys

from .transport import SchedulerValidationError, solve_payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ExamForge scheduler JSON CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("solve", help="Read ScheduleInput JSON from stdin and solve")
    args = parser.parse_args(argv)

    if args.command == "solve":
        return _solve_from_stdin()

    parser.error(f"unsupported command {args.command}")
    return 2


def _solve_from_stdin() -> int:
    try:
        raw_input = json.load(sys.stdin)
        result = solve_payload(raw_input)
    except Exception as exc:
        error_payload = {
            "error": {
                "category": (
                    exc.category
                    if isinstance(exc, SchedulerValidationError)
                    else "validation"
                ),
                "code": (
                    exc.code
                    if isinstance(exc, SchedulerValidationError)
                    else "scheduler_payload_invalid"
                ),
                "message": str(exc),
                "retryable": False,
            }
        }
        if isinstance(exc, SchedulerValidationError):
            error_payload["issues"] = list(exc.issues)
        print(json.dumps(error_payload, ensure_ascii=False))
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

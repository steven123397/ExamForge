import argparse
import json
import sys
from pathlib import Path

from .http_api import create_app


def default_output_path() -> Path:
    return Path(__file__).resolve().parent.parent / "openapi.json"


def render_openapi() -> str:
    document = create_app().openapi()
    return json.dumps(
        document,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate or verify the ExamForge scheduler OpenAPI contract."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output_path(),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    rendered = render_openapi()

    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != rendered:
            print(
                f"OpenAPI contract is stale: {args.output}",
                file=sys.stderr,
            )
            return 1
        return 0

    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import logging
import re
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .http_models import (
    ErrorResponseModel,
    ScheduleInputModel,
    ScheduleResultModel,
    ServiceStatusModel,
)
from .transport import SchedulerValidationError, solve_payload


SCHEDULER_VERSION = "0.1.0"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
logger = logging.getLogger("examforge.scheduler.http")
SolveHandler = Callable[[dict[str, Any]], dict[str, Any]]


def create_app(solve_handler: SolveHandler = solve_payload) -> FastAPI:
    app = FastAPI(
        title="ExamForge Scheduler API",
        version=SCHEDULER_VERSION,
        docs_url=None,
        redoc_url=None,
    )

    @app.middleware("http")
    async def correlate_request(request: Request, call_next):
        candidate = request.headers.get("x-request-id", "")
        request_id = (
            candidate
            if REQUEST_ID_PATTERN.fullmatch(candidate)
            else f"scheduler-{uuid4()}"
        )
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        response.headers["x-scheduler-version"] = SCHEDULER_VERSION
        return response

    @app.exception_handler(RequestValidationError)
    async def handle_contract_error(
        request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        issues = [
            {
                "path": ".".join(str(item) for item in issue["loc"]),
                "message": issue["msg"],
                "type": issue["type"],
            }
            for issue in error.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_error_content(
                request,
                category="validation",
                code="scheduler_contract_invalid",
                message="Scheduler request does not match the HTTP contract.",
                retryable=False,
                issues=issues,
            ),
        )

    @app.exception_handler(SchedulerValidationError)
    async def handle_semantic_error(
        request: Request,
        error: SchedulerValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_content(
                request,
                category=error.category,
                code=error.code,
                message=str(error),
                retryable=error.retryable,
                issues=list(error.issues),
            ),
        )

    @app.exception_handler(Exception)
    async def handle_internal_error(request: Request, error: Exception) -> JSONResponse:
        logger.error(
            "Scheduler request failed request_id=%s error_type=%s",
            _request_id(request),
            type(error).__name__,
        )
        return JSONResponse(
            status_code=500,
            content=_error_content(
                request,
                category="internal",
                code="scheduler_internal_error",
                message="Scheduler failed to process the request.",
                retryable=True,
            ),
        )

    @app.get("/health", response_model=ServiceStatusModel)
    async def health() -> dict[str, Any]:
        return _service_status()

    @app.get("/ready", response_model=ServiceStatusModel)
    async def ready() -> dict[str, Any]:
        return _service_status()

    @app.post(
        "/solve",
        response_model=ScheduleResultModel,
        responses={
            422: {"model": ErrorResponseModel},
            500: {"model": ErrorResponseModel},
        },
    )
    async def solve(schedule_input: ScheduleInputModel) -> dict[str, Any]:
        payload = schedule_input.model_dump(mode="json")
        result = await run_in_threadpool(solve_handler, payload)
        return ScheduleResultModel.model_validate(result).model_dump(mode="json")

    return app


def _service_status() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "examforge-scheduler",
        "version": SCHEDULER_VERSION,
    }


def _error_content(
    request: Request,
    *,
    category: str,
    code: str,
    message: str,
    retryable: bool,
    issues: list[Any] | None = None,
) -> dict[str, Any]:
    content: dict[str, Any] = {
        "error": {
            "category": category,
            "code": code,
            "message": message,
            "retryable": retryable,
        },
        "request_id": _request_id(request),
    }
    if issues is not None:
        content["issues"] = issues
    return content


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", f"scheduler-{uuid4()}")


app = create_app()

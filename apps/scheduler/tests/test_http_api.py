from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from examforge_scheduler.generator import generate_small_dataset
from examforge_scheduler.http_api import create_app
from examforge_scheduler.transport import SchedulerValidationError, to_jsonable


def test_health_and_readiness_are_separate_and_versioned():
    client = TestClient(create_app())

    health = client.get("/health")
    readiness = client.get("/ready")

    assert health.status_code == 200
    assert health.json() == {
        "ok": True,
        "service": "examforge-scheduler",
        "version": "0.1.0",
    }
    assert readiness.status_code == 200
    assert readiness.json() == {
        "ok": True,
        "service": "examforge-scheduler",
        "version": "0.1.0",
    }


def test_solve_propagates_request_id_and_scheduler_version_headers():
    client = TestClient(create_app())
    payload = to_jsonable(generate_small_dataset(seed=20260705))

    response = client.post(
        "/solve",
        json=payload,
        headers={"x-request-id": "request-contract-001"},
    )

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "request-contract-001"
    assert response.headers["x-scheduler-version"] == "0.1.0"
    assert response.json()["statistics"]["status"] == "feasible"


def test_solve_rejects_unknown_fields_with_stable_validation_envelope():
    client = TestClient(create_app())
    payload = to_jsonable(generate_small_dataset(seed=20260705))
    payload["unexpected"] = "not-allowed"

    response = client.post("/solve", json=payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"] == {
        "category": "validation",
        "code": "scheduler_contract_invalid",
        "message": "Scheduler request does not match the HTTP contract.",
        "retryable": False,
    }
    assert body["request_id"] == response.headers["x-request-id"]
    assert body["issues"]


def test_solve_returns_semantic_validation_errors_without_input_leakage():
    client = TestClient(create_app())
    payload = to_jsonable(generate_small_dataset(seed=20260705))
    payload["teachers"][0]["unavailable_slot_ids"] = ["secret-missing-slot"]

    response = client.post("/solve", json=payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "scheduler_input_invalid"
    assert body["error"]["category"] == "validation"
    assert body["error"]["retryable"] is False
    assert body["issues"] == [
        "teacher t001 references missing unavailable_slot_id secret-missing-slot"
    ]
    assert "student_groups" not in response.text


def test_internal_errors_are_sanitized_and_correlated():
    def fail(_payload):
        raise RuntimeError("database-password=do-not-leak")

    client = TestClient(create_app(solve_handler=fail), raise_server_exceptions=False)

    response = client.post(
        "/solve",
        json=to_jsonable(generate_small_dataset(seed=20260705)),
        headers={"x-request-id": "request-internal-001"},
    )

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "category": "internal",
            "code": "scheduler_internal_error",
            "message": "Scheduler failed to process the request.",
            "retryable": True,
        },
        "request_id": "request-internal-001",
    }
    assert "database-password" not in response.text


def test_concurrent_requests_do_not_share_request_state():
    client = TestClient(create_app())
    payload = to_jsonable(generate_small_dataset(seed=20260705))

    def solve(index: int):
        request_id = f"request-concurrent-{index}"
        response = client.post(
            "/solve",
            json=payload,
            headers={"x-request-id": request_id},
        )
        return request_id, response

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(solve, range(2)))

    for request_id, response in responses:
        assert response.status_code == 200
        assert response.headers["x-request-id"] == request_id


def test_semantic_validation_exception_is_mapped_by_the_http_boundary():
    def reject(_payload):
        raise SchedulerValidationError(("contract issue",))

    client = TestClient(create_app(solve_handler=reject))

    response = client.post(
        "/solve",
        json=to_jsonable(generate_small_dataset(seed=20260705)),
    )

    assert response.status_code == 422
    assert response.json()["issues"] == ["contract issue"]

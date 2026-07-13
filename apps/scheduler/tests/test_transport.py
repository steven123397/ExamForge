from dataclasses import replace

import pytest

from examforge_scheduler.generator import generate_small_dataset
from examforge_scheduler.transport import (
    SchedulerValidationError,
    parse_schedule_input,
    solve_payload,
    to_jsonable,
)


def test_transport_rejects_semantically_invalid_schedule_input():
    payload = to_jsonable(generate_small_dataset(seed=20260705))
    payload["teachers"][0]["unavailable_slot_ids"] = ["missing-slot"]

    with pytest.raises(SchedulerValidationError) as captured:
        parse_schedule_input(payload)

    assert captured.value.code == "scheduler_input_invalid"
    assert captured.value.category == "validation"
    assert captured.value.retryable is False
    assert captured.value.issues == (
        "teacher t001 references missing unavailable_slot_id missing-slot",
    )


def test_transport_returns_infeasible_as_a_successful_business_result():
    schedule_input = generate_small_dataset(seed=20260705)
    impossible_rooms = tuple(replace(room, capacity=1) for room in schedule_input.rooms)

    result = solve_payload(to_jsonable(replace(schedule_input, rooms=impossible_rooms)))

    assert result["statistics"]["status"] == "infeasible"
    assert result["score"]["hard_violation_count"] > 0
    assert "report" in result


def test_transport_does_not_mutate_reused_payloads():
    payload = to_jsonable(generate_small_dataset(seed=20260705))
    original = to_jsonable(generate_small_dataset(seed=20260705))

    first = solve_payload(payload)
    second = solve_payload(payload)

    assert payload == original
    assert first["statistics"]["status"] == second["statistics"]["status"]
    assert first["assignments"] == second["assignments"]

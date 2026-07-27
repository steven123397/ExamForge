import pytest
from fastapi.testclient import TestClient

from examforge_scheduler.generator import generate_small_dataset
from examforge_scheduler.http_api import create_app
from examforge_scheduler.transport import (
    SchedulerUnsupportedModeError,
    SchedulerValidationError,
    parse_schedule_input,
    solve_payload,
    to_jsonable,
)


def _payload():
    return to_jsonable(generate_small_dataset(seed=20260705))


def _edge(payload, index_a=0, index_b=1):
    first, second = sorted(
        (payload["exam_tasks"][index_a]["id"], payload["exam_tasks"][index_b]["id"])
    )
    return {
        "exam_task_id_a": first,
        "exam_task_id_b": second,
        "overlap_count": 2,
        "sample_participants": [
            {
                "student_id": "S000001",
                "exam_a_source": "regular",
                "exam_b_source": "retake",
            }
        ],
    }


def test_legacy_payload_without_participant_fields_defaults_to_groups_only():
    schedule_input = parse_schedule_input(_payload())

    assert schedule_input.participant_mode.value == "groups_only"
    assert schedule_input.student_overlap_edges == ()


def test_groups_only_payload_rejects_overlap_edges():
    payload = _payload()
    payload["participant_mode"] = "groups_only"
    payload["student_overlap_edges"] = [_edge(payload)]

    with pytest.raises(SchedulerValidationError) as captured:
        parse_schedule_input(payload)

    assert captured.value.code == "scheduler_input_invalid"
    assert any("groups_only" in issue for issue in captured.value.issues)


def test_enrollment_mode_is_rejected_until_individual_constraints_exist():
    payload = _payload()
    payload["participant_mode"] = "enrollments"
    payload["student_overlap_edges"] = [_edge(payload)]

    with pytest.raises(SchedulerUnsupportedModeError) as captured:
        parse_schedule_input(payload)

    assert captured.value.code == "participant_mode_unsupported"
    assert captured.value.category == "validation"
    assert captured.value.retryable is False


def test_enrollment_mode_never_degrades_to_group_solving_over_http():
    payload = _payload()
    payload["participant_mode"] = "enrollments"
    payload["student_overlap_edges"] = [_edge(payload)]

    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.post("/solve", json=payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "participant_mode_unsupported"
    assert body["error"]["retryable"] is False


def test_overlap_edges_must_be_canonical():
    payload = _payload()
    payload["participant_mode"] = "enrollments"
    edge = _edge(payload)

    self_loop = dict(edge, exam_task_id_b=edge["exam_task_id_a"])
    payload["student_overlap_edges"] = [self_loop]
    with pytest.raises(SchedulerValidationError) as captured:
        parse_schedule_input(payload)
    assert captured.value.code == "scheduler_input_invalid"

    payload["student_overlap_edges"] = [edge, edge]
    with pytest.raises(SchedulerValidationError):
        parse_schedule_input(payload)

    payload["student_overlap_edges"] = [dict(edge, exam_task_id_b="missing-exam")]
    with pytest.raises(SchedulerValidationError):
        parse_schedule_input(payload)


def test_overlap_edges_use_unicode_code_point_order():
    payload = _payload()
    payload["exam_tasks"][0]["id"] = "\ue000"
    payload["exam_tasks"][1]["id"] = "😀"
    payload["participant_mode"] = "enrollments"
    payload["student_overlap_edges"] = [
        {
            "exam_task_id_a": "\ue000",
            "exam_task_id_b": "😀",
            "overlap_count": 1,
            "sample_participants": [],
        }
    ]

    with pytest.raises(SchedulerUnsupportedModeError):
        parse_schedule_input(payload)


def test_groups_only_results_stay_identical_to_the_fifth_version():
    legacy = solve_payload(_payload())

    explicit = _payload()
    explicit["participant_mode"] = "groups_only"
    explicit["student_overlap_edges"] = []
    current = solve_payload(explicit)

    assert legacy["assignments"] == current["assignments"]
    assert legacy["score"] == current["score"]
    assert legacy["conflicts"] == current["conflicts"]

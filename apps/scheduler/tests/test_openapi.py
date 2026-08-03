import json

from examforge_scheduler.openapi import default_output_path, main, render_openapi


def test_openapi_contains_versioned_scheduler_contract():
    document = json.loads(render_openapi())

    assert document["info"] == {
        "title": "ExamForge Scheduler API",
        "version": "0.1.0",
    }
    solve = document["paths"]["/solve"]["post"]
    assert solve["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ScheduleInputModel"
    }
    assert solve["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ScheduleResultModel"
    }
    assert solve["responses"]["422"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponseModel"
    }
    diagnostic = document["components"]["schemas"]["ScheduleDiagnosticModel"]
    assert diagnostic["properties"]["code"]["enum"][-3:] == [
        "student_enrollment_reference_invalid",
        "student_overlap_edge_invalid",
        "student_exam_clash",
    ]
    assert "participant_data" in diagnostic["properties"]["resource_dimension"]["enum"]
    assert "student" in diagnostic["properties"]["resource_dimension"]["enum"]


def test_committed_openapi_matches_deterministic_generation():
    assert default_output_path().read_text(encoding="utf-8") == render_openapi()
    assert main(["--check"]) == 0

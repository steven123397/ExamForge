"""ExamForge scheduler prototype."""

from .generator import (
    generate_medium_dataset,
    generate_scale_dataset,
    generate_small_dataset,
)
from .models import ScheduleInput, ScheduleResult, validate_schedule_input
from .report import build_schedule_report
from .scoring import calculate_score
from .solver import solve_schedule

__all__ = [
    "ScheduleInput",
    "ScheduleResult",
    "build_schedule_report",
    "calculate_score",
    "generate_medium_dataset",
    "generate_scale_dataset",
    "generate_small_dataset",
    "solve_schedule",
    "validate_schedule_input",
]

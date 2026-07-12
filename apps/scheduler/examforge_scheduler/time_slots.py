from .models import TimeSlot


def are_consecutive_time_slots(left: TimeSlot, right: TimeSlot) -> bool:
    return left.date == right.date and abs(left.period_index - right.period_index) == 1

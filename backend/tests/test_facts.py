"""The facts the answer states, computed in code — pure functions, no model, no I/O.

The model never computes or compares a number: it explains these facts. A threshold the
regulation does not state is null with the reason "not_in_regulation", so the answer says
it could not be confirmed instead of inventing a number.
"""

import json
import re
from datetime import datetime, timedelta, timezone

import pytest

from app import facts

RIYADH = timezone(timedelta(hours=3))

THRESHOLDS = {
    "absence_limit_percent": facts.Threshold(value=25, article=25),
    "max_term_load": facts.Threshold(value=20, article=24),
    "max_term_load_exception": facts.Threshold(value=24, article=24),
}


def absences(*percents):
    return {
        "get_absences": {
            "courses": [
                {
                    "code": f"43{index}",
                    "name": f"مقرر {index}",
                    "absence_percent": percent,
                    "absences": 2,
                    "lates": 0,
                }
                for index, percent in enumerate(percents)
            ]
        }
    }


# --- absences -------------------------------------------------------------


def test_absences_below_the_limit_are_not_over_it():
    result = facts.absences_facts(absences(15, 11.86), THRESHOLDS)

    assert result["limit_percent"] == 25
    assert result["limit_article"] == 25
    assert result["max_percent"] == 15
    assert result["any_over"] is False
    assert [course["status"] for course in result["courses"]] == ["below", "below"]
    assert [course["margin_percent"] for course in result["courses"]] == [10, 13.14]


def test_an_absence_at_the_limit_is_at_it_and_not_over():
    result = facts.absences_facts(absences(25), THRESHOLDS)

    assert result["any_over"] is False
    assert result["courses"][0]["status"] == "at"
    assert result["courses"][0]["margin_percent"] == 0


def test_a_course_within_five_points_of_the_limit_is_near_it():
    result = facts.absences_facts(absences(21, 11), THRESHOLDS)

    assert [course["near_limit"] for course in result["courses"]] == [True, False]


def test_an_absence_over_the_limit_is_over_it():
    result = facts.absences_facts(absences(26.5), THRESHOLDS)

    assert result["any_over"] is True
    assert result["courses"][0]["status"] == "over"
    assert result["courses"][0]["margin_percent"] == -1.5


def test_a_missing_absence_threshold_leaves_the_fact_null():
    result = facts.absences_facts(absences(15), {})

    assert result["limit_percent"] is None
    assert result["limit_article"] is None
    assert result["any_over"] is None
    assert result["courses"][0]["status"] is None
    assert result["courses"][0]["margin_percent"] is None
    assert result["reason"] == "not_in_regulation"
    assert result["max_percent"] == 15


# --- academic warning -----------------------------------------------------


def test_the_warning_threshold_is_not_in_the_regulation():
    data = {"get_gpa": {"cumulative_gpa": "4.21", "scale": "5", "earned_hours": 96}}

    result = facts.academic_warning_facts(data, THRESHOLDS)

    assert result["cumulative_gpa"] == 4.21
    assert result["scale"] == 5
    assert result["threshold"] is None
    assert result["below"] is None
    assert result["reason"] == "not_in_regulation"


def test_a_configured_warning_threshold_gives_the_verdict():
    thresholds = {"warning_gpa": facts.Threshold(value=2, article=58)}
    data = {"get_gpa": {"cumulative_gpa": "1.75", "scale": "5"}}

    result = facts.academic_warning_facts(data, thresholds)

    assert result["threshold"] == 2
    assert result["threshold_article"] == 58
    assert result["below"] is True


# --- GPA target ----------------------------------------------------------


def test_the_required_average_over_twelve_fifteen_and_eighteen_hours():
    data = {"get_gpa": {"cumulative_gpa": "4.21", "scale": "5", "earned_hours": 96}}

    result = facts.gpa_target_facts(data, THRESHOLDS, "كم أحتاج عشان يصير معدلي 4.5؟")

    assert result["current_gpa"] == 4.21
    assert result["earned_hours"] == 96
    assert result["target"] == 4.5
    assert result["required_average"] == [
        {"next_hours": 12, "required_average": 6.82, "impossible": True},
        {"next_hours": 15, "required_average": 6.36, "impossible": True},
        {"next_hours": 18, "required_average": 6.05, "impossible": True},
    ]
    assert result["target_possible"] is False


def test_a_reachable_target_is_not_impossible():
    data = {"get_gpa": {"cumulative_gpa": "4.0", "scale": "5", "earned_hours": 96}}

    result = facts.gpa_target_facts(data, THRESHOLDS, "أبغى أوصل معدلي إلى 4.1")

    assert [entry["required_average"] for entry in result["required_average"]] == [
        4.9,
        4.74,
        4.63,
    ]
    assert [entry["impossible"] for entry in result["required_average"]] == [
        False,
        False,
        False,
    ]
    assert result["target_possible"] is True


def test_a_target_above_the_scale_is_impossible():
    data = {"get_gpa": {"cumulative_gpa": "4.0", "scale": "5", "earned_hours": 96}}

    result = facts.gpa_target_facts(data, THRESHOLDS, "أبغى أوصل معدلي إلى 5.5")

    assert result["target"] == 5.5
    assert result["target_possible"] is False
    assert all(entry["impossible"] for entry in result["required_average"])


def test_the_target_is_read_from_arabic_digits():
    data = {"get_gpa": {"cumulative_gpa": "4.0", "scale": "5", "earned_hours": 96}}

    result = facts.gpa_target_facts(data, THRESHOLDS, "أبغى أوصل معدلي إلى ٤٫٥")

    assert result["target"] == 4.5


def test_a_question_without_a_target_has_no_required_average():
    data = {"get_gpa": {"cumulative_gpa": "4.0", "scale": "5", "earned_hours": 96}}

    result = facts.gpa_target_facts(data, THRESHOLDS, "هل معدلي جيد؟")

    assert result["target"] is None
    assert result["required_average"] == []
    assert result["reason"] == "target_not_stated"


# --- graduation ----------------------------------------------------------


def plan(*courses, remaining_hours=23):
    return {
        "get_plan_progress": {
            "completed_hours": 96,
            "remaining_hours": remaining_hours,
            "remaining_courses": [
                {
                    "code": f"SWE {index}",
                    "name": name,
                    "hours": hours,
                    "group": "التخصص",
                    "type": course_type,
                    "level": "7",
                }
                for index, (name, hours, course_type) in enumerate(courses)
            ],
        }
    }


def test_eighteen_remaining_hours_fit_one_term():
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), remaining_hours=18), THRESHOLDS
    )

    assert result["remaining_hours"] == 18
    assert result["max_term_load"] == 20
    assert result["max_term_load_article"] == 24
    assert result["load_status"] == "within"


def test_twenty_remaining_hours_still_fit_one_term():
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), remaining_hours=20), THRESHOLDS
    )

    assert result["load_status"] == "within"


def test_twenty_three_remaining_hours_need_the_deanship_exception():
    """Article 24: the maximum is 20, and the Deanship may raise it to 24."""
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), remaining_hours=23), THRESHOLDS
    )

    assert result["max_term_load"] == 20
    assert result["max_term_load_exception"] == 24
    assert result["max_term_load_exception_article"] == 24
    assert result["load_status"] == "needs_exception"


def test_twenty_five_remaining_hours_are_over_even_the_exception():
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), remaining_hours=25), THRESHOLDS
    )

    assert result["max_term_load_exception"] == 24
    assert result["load_status"] == "over"


def test_a_missing_max_term_load_leaves_the_verdict_null():
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), remaining_hours=23), {}
    )

    assert result["max_term_load"] is None
    assert result["load_status"] is None
    assert result["reason"] == "not_in_regulation"


def test_a_missing_exception_does_not_call_the_middle_band_over():
    """Without the exception threshold, 23 hours are neither within nor known to be over."""
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), remaining_hours=23),
        {"max_term_load": facts.Threshold(value=20, article=24)},
    )

    assert result["max_term_load"] == 20
    assert result["max_term_load_exception"] is None
    assert result["load_status"] is None
    assert result["reason"] == "not_in_regulation"


def test_the_mandatory_remaining_courses_are_named():
    result = facts.graduation_facts(
        plan(
            ("مشروع تخرج -1", 3, "إجباري"),
            ("مشروع تخرج -2", 3, "إجباري"),
            ("مقرر اختياري", 3, "اختياري"),
        ),
        THRESHOLDS,
    )

    assert result["mandatory_courses"] == ["مشروع تخرج -1", "مشروع تخرج -2"]


def test_a_sequence_pair_is_detected():
    result = facts.graduation_facts(
        plan(("مشروع تخرج -1", 3, "إجباري"), ("مشروع تخرج -2", 3, "إجباري")),
        THRESHOLDS,
    )

    assert result["sequence_pairs"] == [
        {
            "first": "مشروع تخرج -1",
            "second": "مشروع تخرج -2",
            "note": "may require the first before the second",
        }
    ]


def test_a_sequence_pair_is_detected_with_brackets():
    result = facts.graduation_facts(
        plan(("تدريب (1)", 3, "إجباري"), ("تدريب (2)", 3, "إجباري")), THRESHOLDS
    )

    assert len(result["sequence_pairs"]) == 1
    assert result["sequence_pairs"][0]["first"] == "تدريب (1)"


def test_a_course_code_number_is_not_a_sequence_pair():
    result = facts.graduation_facts(
        plan(("كيم 104", 3, "إجباري"), ("كيم 105", 3, "إجباري")), THRESHOLDS
    )

    assert result["sequence_pairs"] == []


# --- exam conflicts ------------------------------------------------------


def exams(*entries):
    return {
        "get_final_exams": {
            "exams": [
                {"code": f"SWE {index}", "name": name, "day": "الأحد", "date": date,
                 "time": time, "location": None}
                for index, (name, date, time) in enumerate(entries)
            ]
        }
    }


def test_two_exams_at_the_same_date_and_time_conflict():
    result = facts.exam_conflicts_facts(
        exams(
            ("قواعد البيانات", "6-07-1448", "08:00"),
            ("هندسة البرمجيات", "6-07-1448", "08:00"),
            ("شبكات", "7-07-1448", "08:00"),
        )
    )

    assert result["has_conflicts"] is True
    assert result["conflicts"] == [
        {
            "date": "6-07-1448",
            "time": "08:00",
            "courses": ["قواعد البيانات", "هندسة البرمجيات"],
        }
    ]


def test_two_exams_the_same_day_at_different_times_do_not_conflict():
    result = facts.exam_conflicts_facts(
        exams(
            ("قواعد البيانات", "6-07-1448", "08:00"),
            ("هندسة البرمجيات", "6-07-1448", "11:00"),
        )
    )

    assert result["conflicts"] == []
    assert result["has_conflicts"] is False


def test_an_undated_exam_is_counted_separately():
    result = facts.exam_conflicts_facts(
        exams(("قواعد البيانات", None, None), ("شبكات", "7-07-1448", "08:00"))
    )

    assert result["conflicts"] == []
    assert result["undated_count"] == 1


# --- planning the week ----------------------------------------------------


NOW = datetime(2026, 11, 20, 10, 0, tzinfo=RIYADH)


def week_data():
    return {
        "get_assignments": {
            "items": [
                {"title": "واجب 3", "course": "SWE 483", "due_at": "2026-11-21T23:59:00+03:00"},
                {"title": "واجب 4", "course": "SWE 483", "due_at": "2026-11-28T23:59:00+03:00"},
                {"title": "كويز", "course": "SWE 444", "due_at": "2026-11-24T12:00:00+03:00"},
            ]
        },
        "get_schedule": {
            "term": "الفصل الأول 1448/1449",
            "classes": [
                {"code": "SWE 483", "name": "هندسة البرمجيات", "activity": "محاضرة",
                 "section": "1", "days": [1, 3], "start": "11:00", "end": "11:50"},
                {"code": "SWE 444", "name": "قواعد البيانات", "activity": "محاضرة",
                 "section": "1", "days": [1], "start": "08:00", "end": "08:50"},
                {"code": "SWE 421", "name": "شبكات", "activity": "محاضرة",
                 "section": "1", "days": [5], "start": "09:00", "end": "09:50"},
            ],
        },
    }


def test_only_the_assignments_due_in_the_next_seven_days_are_facts():
    result = facts.plan_week_facts(week_data(), now=NOW)

    titles = [item["title"] for day in result["days"] for item in day["due"]]
    assert titles == ["واجب 3", "كويز"]
    assert result["from"] == "الجمعة 20 نوفمبر"
    assert result["to"] == "الخميس 26 نوفمبر"


def test_the_week_is_seven_days_from_today():
    result = facts.plan_week_facts(week_data(), now=NOW)

    assert [day["date"] for day in result["days"]] == [
        "20 نوفمبر",
        "21 نوفمبر",
        "22 نوفمبر",
        "23 نوفمبر",
        "24 نوفمبر",
        "25 نوفمبر",
        "26 نوفمبر",
    ]
    assert result["days"][0]["day"] == "الجمعة"


def test_a_due_item_sits_under_its_own_day_with_a_readable_time():
    result = facts.plan_week_facts(week_data(), now=NOW)

    saturday = result["days"][1]
    assert saturday["day"] == "السبت"
    assert [item["title"] for item in saturday["due"]] == ["واجب 3"]
    assert saturday["due"][0]["time"] == "11:59 م"
    assert saturday["due"][0]["time_en"] == "11:59 PM"


def test_the_class_slots_are_listed_per_day_and_sorted():
    result = facts.plan_week_facts(week_data(), now=NOW)

    sunday = result["days"][2]
    assert sunday["day"] == "الأحد"
    assert [slot["code"] for slot in sunday["classes"]] == ["SWE 444", "SWE 483"]
    assert sunday["classes"][0]["start"] == "8:00 ص"
    assert sunday["classes"][0]["end_en"] == "8:50 AM"


def test_each_calendar_date_carries_the_schedule_day_it_is():
    """A week from Friday 2026-11-20: Sunday is day 1 and Thursday is day 5, as Edugate numbers them."""
    result = facts.plan_week_facts(week_data(), now=NOW)

    by_date = {day["date"]: day for day in result["days"]}

    friday = by_date["20 نوفمبر"]
    assert friday["day"] == "الجمعة"
    assert friday["classes"] == []
    saturday = by_date["21 نوفمبر"]
    assert saturday["day"] == "السبت"
    assert saturday["classes"] == []

    sunday = by_date["22 نوفمبر"]
    assert sunday["day"] == "الأحد"
    assert [slot["code"] for slot in sunday["classes"]] == ["SWE 444", "SWE 483"]

    thursday = by_date["26 نوفمبر"]
    assert thursday["day"] == "الخميس"
    assert [slot["code"] for slot in thursday["classes"]] == ["SWE 421"]


@pytest.mark.parametrize(
    "date, expected",
    [
        (datetime(2026, 11, 20).date(), 6),  # Friday
        (datetime(2026, 11, 21).date(), 7),  # Saturday
        (datetime(2026, 11, 22).date(), 1),  # Sunday
        (datetime(2026, 11, 23).date(), 2),  # Monday
        (datetime(2026, 11, 24).date(), 3),  # Tuesday
        (datetime(2026, 11, 25).date(), 4),  # Wednesday
        (datetime(2026, 11, 26).date(), 5),  # Thursday
    ],
)
def test_a_calendar_date_maps_to_the_schedule_day_edugate_numbers(date, expected):
    assert facts.contract_day(date) == expected


def test_a_due_item_carries_the_free_blocks_before_it():
    """Tuesday's class runs 11:00-11:50 and the quiz is due at 12:00, so the morning is free."""
    result = facts.plan_week_facts(week_data(), now=NOW)

    tuesday = result["days"][4]
    assert tuesday["day"] == "الثلاثاء"
    quiz = tuesday["due"][0]
    assert quiz["title"] == "كويز"
    assert [block["minutes"] for block in quiz["free_blocks"]] == [180]
    assert quiz["free_blocks"][0]["from"] == "8:00 ص"
    assert quiz["free_blocks"][0]["to"] == "11:00 ص"


def test_a_free_block_is_said_in_hours_and_minutes():
    """959 minutes is "16 ساعة و59 دقيقة", never "959 دقيقة"."""
    result = facts.plan_week_facts(week_data(), now=NOW)

    block = result["days"][4]["due"][0]["free_blocks"][0]
    assert block["minutes"] == 180
    assert block["duration"] == "3 ساعات"
    assert block["duration_en"] == "3 h"


def test_a_day_with_nothing_in_it_has_no_classes_and_no_due_items():
    result = facts.plan_week_facts(week_data(), now=NOW)

    friday = result["days"][0]
    assert friday["classes"] == []
    assert friday["due"] == []


def test_no_iso_timestamp_survives_into_the_facts():
    """The answer says "السبت 21 نوفمبر، 11:59 م", never the raw timestamp."""
    result = facts.plan_week_facts(week_data(), now=NOW)

    assert "2026-11-21T23:59:00+03:00" not in json.dumps(result, ensure_ascii=False)
    assert not re.search(r"\d{4}-\d{2}-\d{2}", json.dumps(result, ensure_ascii=False))


def test_a_plan_week_has_no_verdict():
    result = facts.plan_week_facts(week_data(), now=NOW)

    assert "any_over" not in result
    assert "load_status" not in result


# --- the config ----------------------------------------------------------


def write_config(path, thresholds=None, retrieval=None):
    lines = []
    for name, (value, article) in (thresholds or {}).items():
        lines += [f"[thresholds.{name}]", f"value = {value}", f"article = {article}"]
    lines.append("[retrieval]")
    for kind, queries in (retrieval or {}).items():
        rendered = ", ".join(f'"{query}"' for query in queries)
        lines.append(f"{kind} = [{rendered}]")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_the_thresholds_come_with_the_article_they_come_from(tmp_path):
    path = write_config(
        tmp_path / "reasoning.toml",
        {"absence_limit_percent": (25, 25), "max_term_load": (20, 24)},
    )

    config = facts.load_config(path)

    assert config.thresholds["absence_limit_percent"] == facts.Threshold(25, 25)
    assert config.thresholds["max_term_load"] == facts.Threshold(20, 24)


def test_a_threshold_left_out_is_not_in_the_config(tmp_path):
    path = write_config(tmp_path / "reasoning.toml", {"max_term_load": (20, 24)})

    config = facts.load_config(path)

    assert "warning_gpa" not in config.thresholds
    assert facts.academic_warning_facts(
        {"get_gpa": {"cumulative_gpa": "4.21"}}, config.thresholds
    )["reason"] == "not_in_regulation"


def test_a_threshold_needs_both_a_value_and_an_article(tmp_path):
    path = tmp_path / "reasoning.toml"
    path.write_text("[thresholds.max_term_load]\nvalue = 20\n", encoding="utf-8")

    with pytest.raises(ValueError):
        facts.load_config(path)


def test_the_fixed_queries_are_read_per_kind(tmp_path):
    path = write_config(
        tmp_path / "reasoning.toml",
        retrieval={"graduation": ["العبء الدراسي", "متطلبات التخرج"]},
    )

    config = facts.load_config(path)

    assert config.retrieval["graduation"] == ("العبء الدراسي", "متطلبات التخرج")
    assert config.retrieval.get("plan_week", ()) == ()


def test_the_repository_config_has_the_regulation_thresholds():
    """The shipped config, not a fixture: 25% absence (article 25) and 20 hours (24)."""
    config = facts.load_config()

    assert config.thresholds["absence_limit_percent"] == facts.Threshold(25, 25)
    assert config.thresholds["max_term_load"] == facts.Threshold(20, 24)
    assert config.thresholds["max_term_load_exception"] == facts.Threshold(24, 24)
    assert "warning_gpa" not in config.thresholds
    assert config.retrieval["absences"]
    assert config.retrieval["graduation"]


def test_planning_and_conflicts_need_no_regulation():
    assert facts.needs_regulation("plan_week") is False
    assert facts.needs_regulation("exam_conflicts") is False
    assert facts.needs_regulation("graduation") is True
    assert facts.needs_regulation("absences") is True


def test_every_kind_has_a_fact_builder():
    data = {**absences(15), **plan(("مشروع تخرج -1", 3, "إجباري")), **week_data()}

    for kind in ("graduation", "absences", "gpa_target", "academic_warning",
                 "exam_conflicts", "plan_week"):
        assert facts.build_facts(kind, data, THRESHOLDS, "معدلي 4.5", now=NOW)["kind"] == kind

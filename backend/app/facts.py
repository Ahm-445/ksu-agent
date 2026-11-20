"""The facts the answer states, computed in code from the student's own values.

The model never computes or compares a number: every percentage, margin, average and verdict
in an answer comes from here, and the model only explains it. Each function is pure — the
validated data in, a JSON-shaped dict out — so a fact can be tested without a model.

A threshold the regulation does not state is left out of reasoning.toml. Its fact is then
null with the reason "not_in_regulation", and the answer says it could not be confirmed
rather than inventing a number.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from app.tools import normalise

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "reasoning.toml"

NOT_IN_REGULATION = "not_in_regulation"
TARGET_NOT_STATED = "target_not_stated"
DATA_MISSING = "data_missing"

# Edugate's timestamps carry the KSU offset; a value without one is read as Riyadh time.
RIYADH = timezone(timedelta(hours=3))

REQUIRED_AVERAGE_HORIZONS = (12, 15, 18)
WEEK_DAYS = 7

# 1 = Sunday ... 7 = Saturday, as the schedule tool numbers its days.
DAY_NAMES = {
    1: "الأحد",
    2: "الاثنين",
    3: "الثلاثاء",
    4: "الأربعاء",
    5: "الخميس",
    6: "الجمعة",
    7: "السبت",
}

# Kinds whose question is about the student's plan, not about a rule: no article is needed.
KINDS_WITHOUT_REGULATION = ("plan_week", "exam_conflicts")

_NUMBER = re.compile(r"[0-9]+(?:[.,٫][0-9]+)*")
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# A course that runs over two terms: "مشروع تخرج -1" / "-2", "تدريب (1)" / "(2)". The
# separator is required, so a course code number ("كيم 104") is never a sequence.
_SEQUENCE = re.compile(r"^(?P<base>.+?)\s*(?:-\s*|\(\s*)(?P<number>[12])\s*\)?$")


@dataclass(frozen=True)
class Threshold:
    """One value from the regulation, and the article it comes from."""

    value: float
    article: int


@dataclass(frozen=True)
class ReasoningConfig:
    """The thresholds the facts are computed against and the fixed extra queries."""

    thresholds: Mapping[str, Threshold]
    retrieval: Mapping[str, tuple[str, ...]]


def load_config(config_path: Path = DEFAULT_CONFIG) -> ReasoningConfig:
    """Read reasoning.toml: each threshold with its article, the queries per kind."""
    with Path(config_path).open("rb") as fh:
        data = tomllib.load(fh)

    thresholds: dict[str, Threshold] = {}
    for name, entry in data.get("thresholds", {}).items():
        value = entry.get("value")
        article = entry.get("article")
        if value is None or article is None:
            raise ValueError(f"{config_path}: threshold {name} needs value and article")
        thresholds[name] = Threshold(value=float(value), article=int(article))

    retrieval = {
        kind: tuple(str(query).strip() for query in queries if str(query).strip())
        for kind, queries in data.get("retrieval", {}).items()
    }

    return ReasoningConfig(thresholds=thresholds, retrieval=retrieval)


def needs_regulation(kind: str | None) -> bool:
    """Whether the kind's answer must cite a regulation article."""
    return kind not in KINDS_WITHOUT_REGULATION


def parse_number(value: Any) -> float | None:
    """A number from the data or the question, as a float; None when it is not one.

    Edugate shows a GPA as text ("4,21"), and a student may type Arabic digits, so both are
    read the same way.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None

    text = value.translate(_ARABIC_DIGITS).replace("٫", ".").replace(",", ".").strip()
    try:
        return float(text)
    except ValueError:
        return None


def format_number(value: float | None) -> str:
    """A number as the answer writes it: "15", "11.86", no trailing zeros."""
    if value is None:
        return "—"
    return f"{value:.2f}".rstrip("0").rstrip(".")


def target_from(question: str) -> float | None:
    """The GPA the student asks for, as written in the question; None when absent."""
    match = _NUMBER.search(normalise(question or ""))
    return None if match is None else parse_number(match.group(0))


def absences_facts(
    data: Mapping[str, Any], thresholds: Mapping[str, Threshold]
) -> dict[str, Any]:
    """Each course's absence against the limit, and whether any course is over it."""
    threshold = thresholds.get("absence_limit_percent")
    limit = threshold.value if threshold else None

    courses: list[dict[str, Any]] = []
    for course in data.get("get_absences", {}).get("courses", []) or []:
        percent = parse_number(course.get("absence_percent"))
        entry = {
            "code": course.get("code"),
            "name": course.get("name"),
            "absence_percent": percent,
            "limit_percent": limit,
            "margin_percent": None,
            "status": None,
        }
        if limit is not None and percent is not None:
            margin = round(limit - percent, 2)
            entry["margin_percent"] = margin
            entry["status"] = (
                "below" if margin > 0 else "at" if margin == 0 else "over"
            )
        courses.append(entry)

    percents = [
        course["absence_percent"]
        for course in courses
        if course["absence_percent"] is not None
    ]

    facts: dict[str, Any] = {
        "kind": "absences",
        "limit_percent": limit,
        "limit_article": threshold.article if threshold else None,
        "courses": courses,
        "max_percent": max(percents) if percents else None,
        "any_over": None,
    }
    if limit is None:
        facts["reason"] = NOT_IN_REGULATION
    elif percents:
        facts["any_over"] = any(percent > limit for percent in percents)

    return facts


def academic_warning_facts(
    data: Mapping[str, Any], thresholds: Mapping[str, Threshold]
) -> dict[str, Any]:
    """The student's GPA against the warning threshold, when the regulation states one."""
    gpa = parse_number(data.get("get_gpa", {}).get("cumulative_gpa"))
    threshold = thresholds.get("warning_gpa")

    facts: dict[str, Any] = {
        "kind": "academic_warning",
        "cumulative_gpa": gpa,
        "threshold": None,
        "threshold_article": None,
        "below": None,
    }
    if threshold is None:
        facts["reason"] = NOT_IN_REGULATION
        return facts

    facts["threshold"] = threshold.value
    facts["threshold_article"] = threshold.article
    if gpa is not None:
        facts["below"] = gpa < threshold.value

    return facts


def gpa_target_facts(
    data: Mapping[str, Any], thresholds: Mapping[str, Threshold], question: str
) -> dict[str, Any]:
    """The average the student needs over the next 12, 15 and 18 hours to reach a target."""
    gpa_data = data.get("get_gpa", {})
    gpa = parse_number(gpa_data.get("cumulative_gpa"))
    earned = parse_number(gpa_data.get("earned_hours"))
    scale = parse_number(gpa_data.get("scale"))
    target = target_from(question)

    facts: dict[str, Any] = {
        "kind": "gpa_target",
        "current_gpa": gpa,
        "earned_hours": earned,
        "target": target,
        "scale": scale,
        "required_average": [],
        "target_possible": None,
    }
    if target is None:
        facts["reason"] = TARGET_NOT_STATED
        return facts
    if gpa is None or earned is None:
        facts["reason"] = DATA_MISSING
        return facts

    entries = []
    for hours in REQUIRED_AVERAGE_HORIZONS:
        required = round((target * (earned + hours) - gpa * earned) / hours, 2)
        entry: dict[str, Any] = {
            "next_hours": hours,
            "required_average": required,
            "impossible": None,
        }
        if scale is not None:
            entry["impossible"] = required > scale
        entries.append(entry)
    facts["required_average"] = entries

    if scale is not None:
        facts["target_possible"] = target <= scale and any(
            not entry["impossible"] for entry in entries
        )

    return facts


def graduation_facts(
    data: Mapping[str, Any], thresholds: Mapping[str, Threshold]
) -> dict[str, Any]:
    """What is left, whether one term can hold it, and the courses that run in sequence."""
    plan = data.get("get_plan_progress", {})
    remaining = parse_number(plan.get("remaining_hours"))
    courses = plan.get("remaining_courses", []) or []
    limit = thresholds.get("max_term_load")
    exception = thresholds.get("max_term_load_exception")

    facts: dict[str, Any] = {
        "kind": "graduation",
        "remaining_hours": remaining,
        "max_term_load": None,
        "max_term_load_article": None,
        "max_term_load_exception": None,
        "max_term_load_exception_article": None,
        "load_status": None,
        "mandatory_courses": [
            course.get("name")
            for course in courses
            if str(course.get("type") or "").startswith("إجباري")
        ],
        "sequence_pairs": sequence_pairs(
            [course.get("name") for course in courses if course.get("name")]
        ),
    }
    if limit is None:
        facts["reason"] = NOT_IN_REGULATION
        return facts

    facts["max_term_load"] = limit.value
    facts["max_term_load_article"] = limit.article
    if exception is not None:
        facts["max_term_load_exception"] = exception.value
        facts["max_term_load_exception_article"] = exception.article
    if remaining is not None:
        facts["load_status"] = load_status(
            remaining, limit.value, exception.value if exception else None
        )
        if facts["load_status"] is None:
            facts["reason"] = NOT_IN_REGULATION

    return facts


def load_status(remaining: float, limit: float, exception: float | None) -> str | None:
    """Where the remaining hours fall against the term load and its approved exception.

    Above the limit and up to the exception is not "over": article 24 lets the Deanship of
    Admission and Registration raise the load that far. With no exception threshold the
    middle band is left unclassified instead of being read as "over".
    """
    if remaining <= limit:
        return "within"
    if exception is None:
        return None
    return "needs_exception" if remaining <= exception else "over"


def sequence_pairs(names: list[str]) -> list[dict[str, str]]:
    """Course names that differ only by a trailing "-1"/"-2" or "(1)"/"(2)"."""
    by_base: dict[str, dict[str, str]] = {}
    for name in names:
        match = _SEQUENCE.match(name.strip())
        if match is None:
            continue
        by_base.setdefault(match.group("base").strip(), {})[
            match.group("number")
        ] = name

    pairs = []
    for parts in by_base.values():
        if "1" in parts and "2" in parts:
            pairs.append(
                {
                    "first": parts["1"],
                    "second": parts["2"],
                    "note": "may require the first before the second",
                }
            )
    return pairs


def exam_conflicts_facts(data: Mapping[str, Any]) -> dict[str, Any]:
    """Exams sharing a date and a time; an exam with no date is counted separately."""
    groups: dict[tuple[str, Any], list[str]] = {}
    undated = 0
    for exam in data.get("get_final_exams", {}).get("exams", []) or []:
        date = exam.get("date")
        if date is None:
            undated += 1
            continue
        groups.setdefault((date, exam.get("time")), []).append(exam.get("name"))

    conflicts = [
        {"date": date, "time": time, "courses": names}
        for (date, time), names in groups.items()
        if len(names) > 1
    ]

    return {
        "kind": "exam_conflicts",
        "conflicts": conflicts,
        "undated_count": undated,
        "has_conflicts": bool(conflicts),
    }


def plan_week_facts(
    data: Mapping[str, Any], now: datetime | None = None
) -> dict[str, Any]:
    """The assignments due in the next seven days and the class slots of each day."""
    start = now or datetime.now(RIYADH)
    end = start + timedelta(days=WEEK_DAYS)

    assignments = []
    for item in data.get("get_assignments", {}).get("items", []) or []:
        due = _moment(item.get("due_at"))
        if due is None or not start <= due <= end:
            continue
        assignments.append(
            {
                "title": item.get("title"),
                "course": item.get("course"),
                "due_at": item.get("due_at"),
            }
        )

    by_day: dict[int, list[dict[str, Any]]] = {}
    for slot in data.get("get_schedule", {}).get("classes", []) or []:
        for day in slot.get("days", []) or []:
            by_day.setdefault(int(day), []).append(
                {
                    "code": slot.get("code"),
                    "name": slot.get("name"),
                    "activity": slot.get("activity"),
                    "start": slot.get("start"),
                    "end": slot.get("end"),
                }
            )

    classes = [
        {
            "day": DAY_NAMES.get(day, str(day)),
            "slots": sorted(slots, key=lambda slot: slot["start"] or ""),
        }
        for day, slots in sorted(by_day.items())
    ]

    return {
        "kind": "plan_week",
        "from": start.date().isoformat(),
        "to": end.date().isoformat(),
        "assignments": assignments,
        "classes": classes,
    }


def _moment(value: Any) -> datetime | None:
    """A due_at timestamp with a timezone; a value without one is read as Riyadh time."""
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=RIYADH)


def build_facts(
    kind: str | None,
    data: Mapping[str, Any],
    thresholds: Mapping[str, Threshold],
    question: str,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """The facts for one reasoning kind, or None when the question has no kind."""
    if kind == "absences":
        return absences_facts(data, thresholds)
    if kind == "academic_warning":
        return academic_warning_facts(data, thresholds)
    if kind == "gpa_target":
        return gpa_target_facts(data, thresholds, question)
    if kind == "graduation":
        return graduation_facts(data, thresholds)
    if kind == "exam_conflicts":
        return exam_conflicts_facts(data)
    if kind == "plan_week":
        return plan_week_facts(data, now)
    return None

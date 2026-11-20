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

# A course whose absence is within this many points of the limit is called "قريب" in the
# answer. It is a reading of the numbers, not a rule: no article states it.
NEAR_LIMIT_PERCENT = 5.0

# A free block shorter than this is not worth naming in a week plan.
MIN_FREE_BLOCK_MINUTES = 30

# The earliest hour a free block is offered from: a class that starts at 08:00 leaves nothing.
DAY_START_MINUTES = 8 * 60

_MONTHS_AR = (
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
)
_MONTHS_EN = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
# date.weekday(): Monday is 0, so the list starts there.
_WEEKDAYS_AR = (
    "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد",
)
_WEEKDAYS_EN = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

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
            "near_limit": None,
        }
        if limit is not None and percent is not None:
            margin = round(limit - percent, 2)
            entry["margin_percent"] = margin
            entry["status"] = (
                "below" if margin > 0 else "at" if margin == 0 else "over"
            )
            entry["near_limit"] = 0 <= margin <= NEAR_LIMIT_PERCENT
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
    gpa_data = data.get("get_gpa", {})
    gpa = parse_number(gpa_data.get("cumulative_gpa"))
    scale = parse_number(gpa_data.get("scale"))
    threshold = thresholds.get("warning_gpa")

    facts: dict[str, Any] = {
        "kind": "academic_warning",
        "cumulative_gpa": gpa,
        "scale": scale,
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


def contract_day(date) -> int:
    """The schedule's number for a calendar date: 1 = Sunday … 7 = Saturday.

    Edugate numbers its days that way (1 = Sunday, 5 = Thursday), while date.isoweekday()
    counts Monday as 1, so a date matched to a schedule day goes through here and nowhere else.
    """
    return date.isoweekday() % 7 + 1


def plan_week_facts(
    data: Mapping[str, Any], now: datetime | None = None
) -> dict[str, Any]:
    """The next seven days, each with its classes and the assignments due that day.

    A day lists its classes first and then what is due, and every due item carries the free
    blocks left before its own time, so the answer suggests when to work on it without computing
    anything. Every time and date is written the way the answer says it, in Arabic and in English;
    no timestamp of the data's own is kept in the facts.
    """
    start = now or datetime.now(RIYADH)
    first_day = start.date()
    last_day = first_day + timedelta(days=WEEK_DAYS - 1)

    by_day: dict[int, list[Mapping[str, Any]]] = {}
    for slot in data.get("get_schedule", {}).get("classes", []) or []:
        for day in slot.get("days", []) or []:
            by_day.setdefault(int(day), []).append(slot)

    due_by_date: dict[Any, list[Mapping[str, Any]]] = {}
    for item in data.get("get_assignments", {}).get("items", []) or []:
        due = _moment(item.get("due_at"))
        if due is None or not start <= due or due.date() > last_day:
            continue
        due_by_date.setdefault(due.date(), []).append(item)

    days = []
    for offset in range(WEEK_DAYS):
        date = first_day + timedelta(days=offset)
        slots = sorted(
            by_day.get(contract_day(date), []),
            key=lambda slot: slot.get("start") or "",
        )
        classes = [
            {
                "code": slot.get("code"),
                "name": slot.get("name"),
                "activity": slot.get("activity"),
                "start": _clock_text(slot.get("start")),
                "start_en": _clock_text(slot.get("start"), "en"),
                "end": _clock_text(slot.get("end")),
                "end_en": _clock_text(slot.get("end"), "en"),
            }
            for slot in slots
        ]

        due = []
        for item in sorted(
            due_by_date.get(date, []),
            key=lambda item: _moment(item.get("due_at")),
        ):
            moment = _moment(item.get("due_at"))
            due.append(
                {
                    "title": item.get("title"),
                    "course": item.get("course"),
                    "time": _clock_text(moment.strftime("%H:%M")),
                    "time_en": _clock_text(moment.strftime("%H:%M"), "en"),
                    "free_blocks": _free_blocks(slots, moment),
                }
            )

        days.append(
            {
                "day": _weekday_text(date),
                "day_en": _weekday_text(date, "en"),
                "date": _date_text(date),
                "date_en": _date_text(date, "en"),
                "classes": classes,
                "due": due,
            }
        )

    return {
        "kind": "plan_week",
        "from": _dated_text(first_day),
        "to": _dated_text(last_day),
        "from_en": _dated_text(first_day, "en"),
        "to_en": _dated_text(last_day, "en"),
        "days": days,
    }


def _clock_text(hhmm: Any, lang: str = "ar") -> str:
    """A 24-hour "HH:MM" as the answer says it: 12-hour, with ص/م or AM/PM."""
    minutes = _minutes(hhmm)
    if minutes is None:
        return "—"
    hour, minute = divmod(minutes, 60)
    clock = f"{hour % 12 or 12}:{minute:02d}"
    if lang == "ar":
        return f"{clock} {'ص' if hour < 12 else 'م'}"
    return f"{clock} {'AM' if hour < 12 else 'PM'}"


def _minutes(hhmm: Any) -> int | None:
    """Minutes since midnight for a 24-hour "HH:MM"; None when it is not one."""
    if not isinstance(hhmm, str):
        return None
    try:
        hour, minute = (int(part) for part in hhmm.split(":")[:2])
    except ValueError:
        return None
    return hour * 60 + minute


def _weekday_text(date, lang: str = "ar") -> str:
    """The weekday as the answer says it: "السبت" or "Sat".

    The index is a name lookup only; matching a date to a schedule day goes through contract_day.
    """
    return (_WEEKDAYS_AR if lang == "ar" else _WEEKDAYS_EN)[date.weekday()]


def _date_text(date, lang: str = "ar") -> str:
    """The day and month as the answer says them: "21 نوفمبر" or "21 Nov"."""
    month = (_MONTHS_AR if lang == "ar" else _MONTHS_EN)[date.month - 1]
    return f"{date.day} {month}"


def _dated_text(date, lang: str = "ar") -> str:
    """A day of the week with its date: "السبت 21 نوفمبر" or "Sat 21 Nov"."""
    return f"{_weekday_text(date, lang)} {_date_text(date, lang)}"


def _free_blocks(
    classes: Sequence[Mapping[str, Any]], due: datetime
) -> list[dict[str, Any]]:
    """The free blocks of one day before a due time, from the gaps between its classes.

    A block starts no earlier than DAY_START_MINUTES, ends at the next class or at the due time,
    and is kept only when it is at least MIN_FREE_BLOCK_MINUTES long.
    """
    until = due.hour * 60 + due.minute
    blocks: list[dict[str, Any]] = []
    cursor = DAY_START_MINUTES
    for slot in classes:
        start = _minutes(slot.get("start"))
        end = _minutes(slot.get("end"))
        if start is None or end is None:
            continue
        if start > cursor and start - cursor >= MIN_FREE_BLOCK_MINUTES:
            blocks.append(_block_text(cursor, start))
        cursor = max(cursor, end)
    if until - cursor >= MIN_FREE_BLOCK_MINUTES:
        blocks.append(_block_text(cursor, until))
    return blocks


def _block_text(start: int, end: int) -> dict[str, Any]:
    """One free block as the answer says it, in both languages."""
    clock = f"{start // 60:02d}:{start % 60:02d}"
    until = f"{end // 60:02d}:{end % 60:02d}"
    return {
        "from": _clock_text(clock),
        "from_en": _clock_text(clock, "en"),
        "to": _clock_text(until),
        "to_en": _clock_text(until, "en"),
        "minutes": end - start,
        "duration": _duration_text(end - start),
        "duration_en": _duration_text(end - start, "en"),
    }


def _duration_text(minutes: int, lang: str = "ar") -> str:
    """A length of time as the answer says it: "16 ساعة و59 دقيقة" or "16 h 59 min"."""
    hours, rest = divmod(minutes, 60)
    if lang != "ar":
        if not hours:
            return f"{rest} min"
        return f"{hours} h" + (f" {rest} min" if rest else "")
    parts = []
    if hours:
        parts.append(_counted(hours, "ساعة", "ساعتان", "ساعات"))
    if rest:
        parts.append(_counted(rest, "دقيقة", "دقيقتان", "دقائق"))
    return " و".join(parts)


def _counted(number: int, one: str, two: str, few: str) -> str:
    """An Arabic count that agrees with its noun: دقيقة, دقيقتان, 3 دقائق, 59 دقيقة."""
    if number == 1:
        return one
    if number == 2:
        return two
    if 3 <= number <= 10:
        return f"{number} {few}"
    return f"{number} {one}"


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

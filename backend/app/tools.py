"""Which tool answers a question, decided by rules and not by the model.

The backend only ever decides *which* tools to run: the values are read in the
student's own browser (ADR 0001). This module is pure text matching — no model call,
no I/O — so a question about the student's own GPA costs nothing to classify.

Two kinds of question are answered from the student's own data. A *factual* one ("ما
معدلي؟") reads one page, and the website answers it in the browser. A *reasoning* one
("هل أقدر أتخرج الفصل القادم؟") compares values, so it reads one to three pages and
needs the student's consent to send them. The reasoning patterns are checked first:
"كم أحتاج أجيب عشان يصير معدلي 4.5؟" carries the possessive of the GPA question but
asks for a target, not the GPA itself.

Only a question about the student's *own* data maps to a tool. The regulation
questions that mention the same words in general ("كم المعدل المطلوب للتخرج؟",
"ما شروط الحرمان؟", "متى الاختبار النهائي؟") stay ordinary answers from the
regulation, so the match needs the possessive form ("معدلي", "غيابي", "my gpa") or a
colloquial name for the student's own page ("الفاينل", "درجات المواد").
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Harakat, the superscript alef and tatweel carry no meaning for matching, and
# students type them inconsistently.
_MARKS = re.compile(r"[\u0640\u064b-\u0655\u0670]")

_ALEF_FORMS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي"})

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

# --- Reasoning questions: what the student should do with their values -----------
#
# Each pattern needs the student's own situation, not a rule: "متى التخرج؟" is a
# regulation answer, "متى أتخرج؟" is this student's plan and GPA.

# "هل أقدر أتخرج الفصل القادم؟" / "متى أتخرج؟". `normalise` rewrites "ى" as "ي",
# so the question is matched as "متي اتخرج". The question word is required: "كم المعدل
# المطلوب عشان أتخرج؟" asks for a requirement, so it stays an ordinary answer.
# "بإمكاني التخرج" and "عشان أتخرج" name the student without a question word, while
# "ما شروط أن أستطيع التخرج؟" stays a rule: أستطيع التخرج only counts after هل or متى.
_ARABIC_GRADUATION = re.compile(
    r"(?:متي|هل|اقدر|نقدر|يمكن(?:ني)?|يمكننا)\s+(?:انا\s+|احنا\s+)?"
    r"(?:اقدر\s+|نقدر\s+|استطيع\s+|نستطيع\s+)?(?:اتخرج|نتخرج)(?![\u0621-\u064a])"
    r"|(?:هل|متي)\s+(?:انا\s+)?(?:استطيع|نستطيع|بامكاني|بامكاننا)\s+"
    r"(?:ال)?تخرج(?![\u0621-\u064a])"
    r"|(?:بامكاني|بامكاننا)\s+(?:ال)?تخرج(?![\u0621-\u064a])"
    r"|(?:عشان|علشان)\s+(?:انا\s+)?(?:اتخرج|نتخرج|التخرج)(?![\u0621-\u064a])"
)

# "can I graduate next term?", "when will I graduate?", "is it possible for me to graduate?".
_ENGLISH_GRADUATION = re.compile(
    r"\b(?:can|could|will|would|do)\s+i\s+graduate\b"
    r"|\bwhen\s+(?:will\s+|do\s+)?i\s+graduate\b"
    r"|\bam\s+i\s+graduating\b"
    r"|\bis\s+it\s+possible\s+(?:for\s+me\s+)?to\s+graduate\b"
)

# "المطلوب" and "شروط" name a requirement, and a question that names one asks about the
# rule even when it says عشان أتخرج: "كم المعدل المطلوب عشان أتخرج؟" asks what the
# regulation requires, while "كم باقي لي عشان أتخرج؟" asks about this student's own plan.
# "المطلوب مني" is the exception — what the student still has to hand in.
_REQUIREMENT = re.compile(r"المطلوب(?!\s+مني)|شروط")

# "هل أنا قريب من الحرمان؟" / "كم غياب باقي لي قبل الحرمان في 434" / "هل تجاوزت نسبة
# الغياب المسموح بها؟". The regulation question "ما شروط الحرمان؟" names no student, so it
# stays an ordinary answer.
_ARABIC_NEAR_DEPRIVATION = re.compile(
    r"(?:قريب(?:ة|ه)?|قربت)\s*(?:من|عن)\s*(?:ال)?حرمان"
    r"|(?:علي\s+)?وشك\s+(?:ال)?حرمان"
    r"|باقي\s*(?:لي|لنا)[^.?!]{0,30}حرمان"
    r"|(?:كم|قد)\s*(?:غياب|غيابات)\s*(?:باقي|لي|لنا)"
    r"|(?:تجاوزت|تعديت)[^.?!]{0,20}غياب"
)

# "am I close to being barred?", "how many absences do I have left before …?".
_ENGLISH_NEAR_DEPRIVATION = re.compile(
    r"\bam\s+i\b[^.?!]{0,40}\b(?:barred|deprived|deprivation)\b"
    r"|\b(?:close|near)\s+to\s+(?:being\s+)?(?:barred|deprived)\b"
    r"|\bhow\s+many\s+absences?\b[^.?!]{0,40}\b(?:left|before)\b"
)

# "كم أحتاج أجيب عشان يصير معدلي 4.5؟" asks what average a target needs. It is a kind
# of its own: the fact it needs is the required average, not a verdict on a threshold.
# "أبي أرفع معدلي إلى 4.5" names the target first and asks for the average after.
_ARABIC_GPA_TARGET = re.compile(
    r"(?:عشان|علشان|حتي)[^.?!]{0,10}(?:يصير|يكون|اوصل|ارفع)[^.?!]{0,25}معدل"
    r"|(?:ارفع|احسن|ازيد|لرفع|لتحسين|لزياد(?:ة|ه))[^.?!]{0,15}معدل"
)

# "هل أنا تحت الإنذار؟" asks about the student's standing against the warning threshold.
# The regulation question "ما هو الإنذار الأكاديمي؟" carries no "أنا", so it stays an
# ordinary answer.
_ARABIC_ACADEMIC_WARNING = re.compile(
    r"انا[^.?!]{0,25}(?:ال)?انذار"
    r"|(?:ال)?انذار[^.?!]{0,25}(?:انا|علي\s+وشك)"
)

# "what do I need to raise my GPA to 4.5?", "am I on academic warning?".
_ENGLISH_GPA_TARGET = re.compile(
    r"\bwhat\s+(?:do\s+i|grades?\s+do\s+i)\s+need\b[^.?!]{0,50}\b(?:gpa|average)\b"
    r"|\b(?:raise|improve|bring\s+up)\s+my\s+(?:gpa|average)\b"
    r"|\bdo\s+i\s+need\b[^.?!]{0,40}\b(?:to\s+raise|for)\b[^.?!]{0,25}\bgpa\b"
)
_ENGLISH_ACADEMIC_WARNING = re.compile(
    r"\bam\s+i\s+(?:on|under)\s+(?:academic\s+)?warning\b"
)

# "هل عندي تعارض في الاختبارات النهائية؟": two exams at the same time is a
# comparison of dates, so it needs the exam page and the schedule behind it. Hijazi
# names them الفاينل.
_ARABIC_EXAM_CONFLICT = re.compile(
    r"تعارض[^.?!]{0,30}(?:اختبار|فاينل)|(?:اختبار|فاينل)[^.?!]{0,30}تعارض"
)
_ENGLISH_EXAM_CONFLICT = re.compile(
    r"\b(?:exam|final)s?\b[^.?!]{0,30}\bconflicts?\b"
    r"|\bconflicts?\b[^.?!]{0,30}\b(?:exam|final)s?\b"
    r"|\b(?:exam|final)s?\b[^.?!]{0,20}\bclash(?:es|ing)?\b"
)

# "كيف أوزع وقتي هالأسبوع؟" / "plan my week": the due dates and the class
# times are compared to fit the work into the week.
_ARABIC_PLAN_WEEK = re.compile(
    r"(?:اوزع|تنظيم|انظم|ارتب)[^.?!]{0,15}(?:وقتي|وقتنا)"
    r"|(?:وقتي|وقتنا)[^.?!]{0,15}(?:هالاسبوع|الاسبوع|هذا\s+الاسبوع)"
)
_ENGLISH_PLAN_WEEK = re.compile(
    r"\bplan\s+(?:my|out)\s+(?:week|time)\b"
    r"|\b(?:organi[sz]e|schedule)\s+my\s+(?:week|time)\b"
    r"|\bhow\s+(?:do\s+i|should\s+i)\s+(?:plan|organi[sz]e|manage)\b"
)

# --- Factual questions: one page, answered in the browser ----------------------

# "معدلي" / "معدلنا": the possessive suffix is what makes the question personal.
# The lookahead stops a longer word that merely starts the same way.
_ARABIC_OWN_GPA = re.compile(r"معدل(?:ي|نا)(?![\u0621-\u064a])")

# "my gpa", "my cumulative gpa", "what is my gpa".
_ENGLISH_OWN_GPA = re.compile(r"\bmy\s+(?:cumulative\s+)?gpa\b")

# "درجاتي" / "درجاتنا" and "درجات المواد": the student's own course results.
_ARABIC_OWN_GRADES = re.compile(
    r"درجات(?:ي|نا)(?![\u0621-\u064a])|درجات\s+المواد"
)

# "my grades", "my course grades".
_ENGLISH_OWN_GRADES = re.compile(r"\bmy\s+(?:course\s+)?grades\b")

# "جدولي" / "جدولنا": the student's own timetable.
_ARABIC_OWN_SCHEDULE = re.compile(r"جدول(?:ي|نا)(?![\u0621-\u064a])")

# "my schedule", "my class schedule".
_ENGLISH_OWN_SCHEDULE = re.compile(r"\bmy\s+(?:class\s+)?schedule\b")

# "اختباراتي" / "اختباراتنا" and the colloquial "الفاينل". The regulation question
# "متى الاختبار النهائي؟" has neither, so it stays an ordinary answer.
_ARABIC_OWN_FINAL_EXAMS = re.compile(
    r"اختبارات(?:ي|نا)(?![\u0621-\u064a])|الفاينل"
)

# "my final exam", "my final exams".
_ENGLISH_OWN_FINAL_EXAMS = re.compile(r"\bmy\s+final\s+exams?\b")

# "غيابي" / "نسبة غيابي" / "غيابنا".
_ARABIC_OWN_ABSENCES = re.compile(r"غياب(?:ي|نا)(?![\u0621-\u064a])")

# "my absences", "my absence percentage".
_ENGLISH_OWN_ABSENCES = re.compile(
    r"\bmy\s+absences?\b|\bmy\s+absence\s+percentage\b"
)

# "كم باقي لي ساعات" / "المقررات المتبقية" / "كم ساعة باقية على التخرج": the student's
# own study plan. The regulation question "كم ساعة يحتاج التخرج في هندسة البرمجيات؟"
# asks how many hours a programme needs, not how many the student has left, so it stays
# an ordinary answer. `normalise` rewrites "على" as "علي", so the pattern does too.
_ARABIC_OWN_PLAN = re.compile(
    r"باقي\s*(?:لي|لنا)\s*(?:كم\s*)?ساع"
    r"|المقررات\s+المتبقي(?:ة|ه)?"
    r"|باقي(?:ة|ه)?\s+علي\s+(?:ال)?تخرج"
)

# "مقرراتي" / "مقرراتنا": the student's own courses this term. The regulation question
# "كيف أسجل في المقررات؟" is about registering, not about the student's list, so it stays
# an ordinary answer.
_ARABIC_OWN_COURSES = re.compile(r"مقررات(?:ي|نا)(?![\u0621-\u064a])")

# "my courses", "my lms courses".
_ENGLISH_OWN_COURSES = re.compile(r"\bmy\s+(?:lms\s+)?courses\b")

# "واجباتي" / "واجباتنا" / "تسليماتي", the LMS's own "الواجبات القادمة" and "الواجبات
# المستحقة", and the student asking what is due: what they still have to hand in. The
# regulation questions "ما هي سياسة الواجبات؟" and "سياسة تأخير تسليم الواجبات" are about
# a policy, so "تسليم الواجب" only counts in the singular and with nothing after it.
_ARABIC_OWN_ASSIGNMENTS = re.compile(
    r"واجبات(?:ي|نا)(?![\u0621-\u064a])"
    r"|تسليمات(?:ي|نا)?(?![\u0621-\u064a])"
    r"|الواجبات\s+القادم(?:ة|ه)?"
    r"|الواجبات\s+المستحق(?:ة|ه)?"
    r"|تسليم\s+الواجب(?![\u0621-\u064a])"
    r"|المطلوب\s+مني"
    r"|واجبات\s+هالاسبوع"
)

# "my assignments", "my due dates", "what's due", "upcoming assignments".
_ENGLISH_OWN_ASSIGNMENTS = re.compile(
    r"\bmy\s+(?:lms\s+)?assignments?\b"
    r"|\bmy\s+due\s+dates?\b"
    r"|\bwhat(?:'s|\s+is)\s+due\b"
    r"|\bupcoming\s+assignments?\b"
)

# "متى الواجب القادم في مادة 444" / "when is my next assignment in course 444": one
# item on the LMS due dates page. The lookahead keeps "الواجبات" (above) out of it.
_ARABIC_NEXT_ASSIGNMENT = re.compile(
    r"الواجب\s+القادم(?![\u0621-\u064a])"
)
_ENGLISH_NEXT_ASSIGNMENT = re.compile(r"\bnext\s+assignment\b")

# "هل عندي اختبار بكرة": whether anything is due tomorrow. The LMS due dates page
# answers it, so the question reads one page and is answered in the browser.
_ARABIC_EXAM_SOON = re.compile(
    r"عندي\s+اختبار(?![\u0621-\u064a])"
    r"|اختبار\s+(?:بكرة|بكره|غدا|الليلة)"
)
_ENGLISH_EXAM_SOON = re.compile(
    r"\b(?:do\s+i\s+have|have\s+i\s+got)\s+an?\s+(?:exam|quiz|test)\b"
    r"|\b(?:exam|quiz|test)\s+(?:tomorrow|today)\b"
)

# The LMS gradebook: named as "البلاك بورد" or "lms", or a single grade that only the
# LMS's gradebook holds — a midterm, an assignment, a quiz. Without one of those the
# question is about the Edugate course results, so "درجاتي" alone stays `get_grades`.
_ARABIC_LMS_GRADES = re.compile(
    r"(?:درجات|علامات)(?:ي|نا)[^.?!]{0,20}(?:البلاك\s*بورد|بلاك\s*بورد|lms)"
    r"|درجة\s+الميد\s*ترم"
    r"|درجة\s+الميدتيرم"
    r"|درجات\s+الواجبات"
    r"|درجات\s+الكويزات?"
    r"|جبت\s+في\s+(?:ال)?(?:كويز|اختبار|ميدترم|واجب)"
)
_ENGLISH_LMS_GRADES = re.compile(
    r"\bmy\s+(?:lms|blackboard)\s+grades\b"
    r"|\bmy\s+grades\s+(?:on|in)\s+(?:the\s+)?(?:lms|blackboard)\b"
)

# "how many hours left", "how many hours do I have left", "remaining credit hours".
_ENGLISH_OWN_PLAN = re.compile(
    r"\bhow\s+many\s+hours?\s+(?:do\s+i\s+have\s+)?left\b"
    r"|\bremaining\s+(?:credit\s+)?hours\b"
)


REASONING_GRADUATION = "graduation"
def normalise(message: str) -> str:
    """Lower-case, digit-normalised text with the Arabic marks removed."""
    text = unicodedata.normalize("NFKC", message)
    text = _MARKS.sub("", text)
    text = text.translate(_ALEF_FORMS).translate(_ARABIC_DIGITS)
    return " ".join(text.split()).lower()


REASONING_ABSENCES = "absences"
REASONING_GPA_TARGET = "gpa_target"
REASONING_ACADEMIC_WARNING = "academic_warning"
REASONING_EXAM_CONFLICTS = "exam_conflicts"
REASONING_PLAN_WEEK = "plan_week"

# The tools each kind reads, in the order the website runs them. The kind itself is
# internal: /chat names only these tools.
REASONING_TOOLS: dict[str, tuple[str, ...]] = {
    REASONING_GRADUATION: ("get_plan_progress", "get_gpa"),
    REASONING_ABSENCES: ("get_absences",),
    REASONING_GPA_TARGET: ("get_gpa",),
    REASONING_ACADEMIC_WARNING: ("get_gpa",),
    REASONING_EXAM_CONFLICTS: ("get_final_exams",),
    REASONING_PLAN_WEEK: ("get_assignments", "get_schedule"),
}

# Checked in this order. A question that matches two patterns is the first kind: the
# graduation wording is the most specific, and the GPA target is checked before the
# warning because "عشان يصير معدلي" asks for a target even when it names the warning.
_REASONING_PATTERNS: tuple[tuple[str, re.Pattern[str], re.Pattern[str]], ...] = (
    (REASONING_GRADUATION, _ARABIC_GRADUATION, _ENGLISH_GRADUATION),
    (REASONING_ABSENCES, _ARABIC_NEAR_DEPRIVATION, _ENGLISH_NEAR_DEPRIVATION),
    (REASONING_GPA_TARGET, _ARABIC_GPA_TARGET, _ENGLISH_GPA_TARGET),
    (
        REASONING_ACADEMIC_WARNING,
        _ARABIC_ACADEMIC_WARNING,
        _ENGLISH_ACADEMIC_WARNING,
    ),
    (REASONING_EXAM_CONFLICTS, _ARABIC_EXAM_CONFLICT, _ENGLISH_EXAM_CONFLICT),
    (REASONING_PLAN_WEEK, _ARABIC_PLAN_WEEK, _ENGLISH_PLAN_WEEK),
)


def _asks_about_a_requirement(text: str, position: int) -> bool:
    """Whether a requirement word comes before `position`, so the question asks for it.

    The wording after the graduation pattern names the student's own situation ("باقي لي
    عشان أتخرج"), and a requirement word before it names the rule ("المعدل المطلوب
    عشان أتخرج").
    """
    found = _REQUIREMENT.search(text)

    return found is not None and found.start() < position


@dataclass(frozen=True)
class ToolRequest:
    """What the website should run: the tools, and whether the question is reasoning.

    `reasoning` is False for a factual question, whose single tool the website answers
    in the browser. True means the tools' values are compared for one answer, so they are
    sent once, after the student approves that one question.
    """

    tools: tuple[str, ...]
    reasoning: bool = False


def detect_reasoning_kind(message: str) -> str | None:
    """Which reasoning kind a question is, or None when it is not a reasoning one.

    The kind decides the facts the backend computes for the answer. It is derived from
    the message alone and never sent to the website.
    """
    text = normalise(message)

    for kind, arabic, english in _REASONING_PATTERNS:
        found = arabic.search(text) or english.search(text)

        if found is None or _asks_about_a_requirement(text, found.start()):
            continue

        return kind

    return None


def detect_reasoning_tools(message: str) -> tuple[str, ...] | None:
    """The tools a reasoning question needs, in the order the website runs them, or None.

    None means the question is not a reasoning one: the caller then checks the factual
    patterns, or answers from the regulation.
    """
    kind = detect_reasoning_kind(message)

    return None if kind is None else REASONING_TOOLS[kind]


def detect_personal_tool(message: str) -> str | None:
    """The tool for a factual question about the student's own data, or None.

    None means "not one page": either a reasoning question, which
    `detect_personal_request` answers with its own tools, or a question about the
    regulation, where the caller runs retrieval and the model.
    """
    text = normalise(message)

    if _ARABIC_OWN_GPA.search(text) or _ENGLISH_OWN_GPA.search(text):
        return "get_gpa"

    # Before the Edugate course results: a question that names the LMS is about its
    # gradebook, and its wording usually carries the same possessive.
    if _ARABIC_LMS_GRADES.search(text) or _ENGLISH_LMS_GRADES.search(text):
        return "get_lms_grades"

    if _ARABIC_OWN_GRADES.search(text) or _ENGLISH_OWN_GRADES.search(text):
        return "get_grades"

    if _ARABIC_OWN_SCHEDULE.search(text) or _ENGLISH_OWN_SCHEDULE.search(text):
        return "get_schedule"

    if _ARABIC_OWN_FINAL_EXAMS.search(text) or _ENGLISH_OWN_FINAL_EXAMS.search(
        text
    ):
        return "get_final_exams"

    if _ARABIC_OWN_ABSENCES.search(text) or _ENGLISH_OWN_ABSENCES.search(text):
        return "get_absences"

    if _ARABIC_OWN_PLAN.search(text) or _ENGLISH_OWN_PLAN.search(text):
        return "get_plan_progress"

    if _ARABIC_OWN_ASSIGNMENTS.search(text) or _ENGLISH_OWN_ASSIGNMENTS.search(
        text
    ):
        return "get_assignments"

    if _ARABIC_NEXT_ASSIGNMENT.search(text) or _ENGLISH_NEXT_ASSIGNMENT.search(
        text
    ):
        return "get_assignments"

    if _ARABIC_EXAM_SOON.search(text) or _ENGLISH_EXAM_SOON.search(text):
        return "get_assignments"

    if _ARABIC_OWN_COURSES.search(text) or _ENGLISH_OWN_COURSES.search(text):
        return "get_courses"

    return None


def detect_personal_request(message: str) -> ToolRequest | None:
    """What the website should run for a question, or None for the regulation.

    The endpoint's one entry point: the reasoning patterns are checked before the
    factual ones, so a reasoning question is never answered from one page.
    """
    reasoning = detect_reasoning_tools(message)

    if reasoning is not None:
        return ToolRequest(tools=reasoning, reasoning=True)

    tool = detect_personal_tool(message)

    return None if tool is None else ToolRequest(tools=(tool,))

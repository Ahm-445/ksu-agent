"""Which tool answers a question, decided by rules and not by the model.

The backend only ever decides *which* tool to run: the values are read in the
student's own browser (ADR 0001). This module is pure text matching — no model call,
no I/O — so a question about the student's own GPA costs nothing to classify.

Only a question about the student's *own* data maps to a tool. The regulation
questions that mention the same words in general ("كم المعدل المطلوب للتخرج؟",
"ما شروط الحرمان؟", "متى الاختبار النهائي؟") stay ordinary answers from the
regulation, so the match needs the possessive form ("معدلي", "غيابي", "my gpa") or a
colloquial name for the student's own page ("الفاينل", "درجات المواد").
"""

from __future__ import annotations

import re
import unicodedata

# Harakat, the superscript alef and tatweel carry no meaning for matching, and
# students type them inconsistently.
_MARKS = re.compile(r"[\u0640\u064b-\u0655\u0670]")

_ALEF_FORMS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي"})

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

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


def normalise(message: str) -> str:
    """Lower-case, digit-normalised text with the Arabic marks removed."""
    text = unicodedata.normalize("NFKC", message)
    text = _MARKS.sub("", text)
    text = text.translate(_ALEF_FORMS).translate(_ARABIC_DIGITS)
    return " ".join(text.split()).lower()


def detect_personal_tool(message: str) -> str | None:
    """The tool for a question about the student's own data, or None.

    None means "answer from the regulation": the caller runs retrieval and the model.
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

    if _ARABIC_OWN_FINAL_EXAMS.search(text) or _ENGLISH_OWN_FINAL_EXAMS.search(text):
        return "get_final_exams"

    if _ARABIC_OWN_ABSENCES.search(text) or _ENGLISH_OWN_ABSENCES.search(text):
        return "get_absences"

    if _ARABIC_OWN_PLAN.search(text) or _ENGLISH_OWN_PLAN.search(text):
        return "get_plan_progress"

    if _ARABIC_OWN_ASSIGNMENTS.search(text) or _ENGLISH_OWN_ASSIGNMENTS.search(text):
        return "get_assignments"

    if _ARABIC_OWN_COURSES.search(text) or _ENGLISH_OWN_COURSES.search(text):
        return "get_courses"

    return None

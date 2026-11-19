"""Which tool answers a question, decided by rules and not by the model.

The backend only ever decides *which* tool to run: the values are read in the
student's own browser (ADR 0001). This module is pure text matching — no model call,
no I/O — so a question about the student's own GPA costs nothing to classify.

Only a question about the student's *own* data maps to a tool. The regulation
questions that mention the same words in general ("كم المعدل المطلوب للتخرج؟",
"ما شروط الحرمان؟", "when is the final exam?") stay ordinary answers from the
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

# "غيابي" / "نسبة غيابي" / "غيابنا".
_ARABIC_OWN_ABSENCES = re.compile(r"غياب(?:ي|نا)(?![\u0621-\u064a])")

# "my absences", "my absence percentage".
_ENGLISH_OWN_ABSENCES = re.compile(
    r"\bmy\s+absences?\b|\bmy\s+absence\s+percentage\b"
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

    if _ARABIC_OWN_ABSENCES.search(text) or _ENGLISH_OWN_ABSENCES.search(text):
        return "get_absences"

    return None

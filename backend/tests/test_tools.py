"""Detection of questions about the student's own data — no model, no I/O.

`detect_personal_tool` decides which tool the website should run. It must fire only
for a question about the student's *own* GPA: the regulation questions that talk
about "المعدل التراكمي" in general must stay ordinary answers.
"""

import pytest

from app.tools import detect_personal_tool

PERSONAL = [
    "ما معدلي؟",
    "كم معدلي التراكمي؟",
    "وش معدلي",
    "أبغى أعرف معدلي",
    "ما هو معدلي التراكمي",
    "معدلي هذا الفصل",
    "مَعدَلي",
    "مـعـدلـي",
    "What is my GPA?",
    "my cumulative gpa",
    "MY GPA",
    "what is my gpa",
    "Can you tell me my cumulative GPA?",
]

REGULATION = [
    "كم المعدل المطلوب للتخرج؟",
    "ما هو المعدل التراكمي؟",
    "كيف يُحسب المعدل التراكمي؟",
    "متى يُحرم الطالب من الاختبار النهائي؟",
    "ما هو الإنذار الأكاديمي؟",
    "كم مدة الفصل الصيفي؟",
    "ما هي شروط التخرج؟",
    "how is the GPA calculated?",
    "what is the minimum GPA to graduate?",
    "what is the cumulative GPA requirement?",
    "when is the final exam?",
]


@pytest.mark.parametrize("message", PERSONAL)
def test_a_question_about_the_students_own_gpa_is_get_gpa(message):
    assert detect_personal_tool(message) == "get_gpa"


@pytest.mark.parametrize("message", REGULATION)
def test_a_question_about_the_regulation_is_not_a_tool(message):
    assert detect_personal_tool(message) is None


def test_an_empty_question_is_not_a_tool():
    assert detect_personal_tool("") is None
    assert detect_personal_tool("   ") is None


def test_a_question_about_other_personal_data_is_not_get_gpa_yet():
    """Only the GPA tool exists in this step; grades and schedule come later."""
    assert detect_personal_tool("وش درجاتي؟") is None
    assert detect_personal_tool("what are my grades?") is None

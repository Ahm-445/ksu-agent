"""Detection of questions about the student's own data — no model, no I/O.

`detect_personal_tool` decides which tool the website should run. It must fire only
for a question about the student's *own* data: the regulation questions that talk
about "المعدل التراكمي" or "شروط الحرمان" in general must stay ordinary answers.
"""

import pytest

from app.tools import detect_personal_tool

PERSONAL = {
    "get_gpa": [
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
    ],
    "get_grades": [
        "درجاتي",
        "وش درجاتي؟",
        "درجات المواد",
        "كم جبت في المواد؟ درجات المواد",
        "my grades",
        "what are my course grades?",
    ],
    "get_schedule": [
        "جدولي",
        "وش جدولي هذا الفصل؟",
        "أبغى جدولنا الدراسي",
        "my schedule",
        "what is my class schedule?",
    ],
    "get_final_exams": [
        "اختباراتي النهائية",
        "متى اختباراتي؟",
        "وش اختباراتنا النهائية",
        "متى الفاينل؟",
        "my final exams",
        "when is my final exam?",
    ],
    "get_absences": [
        "غيابي",
        "كم نسبة غيابي؟",
        "وش غيابي في المواد؟",
        "غيابنا هذا الفصل",
        "my absences",
        "what is my absence percentage?",
    ],
}

REGULATION = [
    "كم المعدل المطلوب للتخرج؟",
    "ما هو المعدل التراكمي؟",
    "كيف يُحسب المعدل التراكمي؟",
    "متى يُحرم الطالب من الاختبار النهائي؟",
    "ما هو الإنذار الأكاديمي؟",
    "كم مدة الفصل الصيفي؟",
    "ما هي شروط التخرج؟",
    "ما شروط الحرمان؟",
    "كم نسبة الغياب المسموحة؟",
    "how is the GPA calculated?",
    "what is the minimum GPA to graduate?",
    "what is the cumulative GPA requirement?",
    "when is the final exam?",
    "how many absences are allowed?",
]


@pytest.mark.parametrize(
    ("message", "tool"),
    [(message, tool) for tool, messages in PERSONAL.items() for message in messages],
)
def test_a_question_about_the_students_own_data_is_its_tool(message, tool):
    assert detect_personal_tool(message) == tool


@pytest.mark.parametrize("message", REGULATION)
def test_a_question_about_the_regulation_is_not_a_tool(message):
    assert detect_personal_tool(message) is None


def test_an_empty_question_is_not_a_tool():
    assert detect_personal_tool("") is None
    assert detect_personal_tool("   ") is None


def test_a_question_about_personal_data_without_a_reader_is_not_a_tool_yet():
    """The study plan comes in the next commit."""
    assert detect_personal_tool("كم باقي لي ساعات؟") is None
    assert detect_personal_tool("how many hours do I have left?") is None

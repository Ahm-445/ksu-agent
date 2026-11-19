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
    "get_plan_progress": [
        "كم باقي لي ساعات؟",
        "المقررات المتبقية",
        "كم ساعة باقية على التخرج؟",
        "how many hours left",
    ],
    "get_courses": [
        "وش مقرراتي هذا الفصل؟",
        "مقرراتي",
        "أبغى أشوف مقرراتنا",
        "my courses",
        "what are my lms courses?",
    ],
    "get_assignments": [
        "وش واجباتي؟",
        "واجباتي القادمة",
        "متى تسليماتي؟",
        "my assignments",
        "what is due this week?",
    ],
    "get_lms_grades": [
        "درجاتي في البلاك بورد",
        "وش درجاتي في lms؟",
        "my grades on blackboard",
        "my lms grades",
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
    "ما هي متطلبات الجامعة؟",
    "كم ساعة يحتاج التخرج في هندسة البرمجيات؟",
    "how is the GPA calculated?",
    "what is the minimum GPA to graduate?",
    "what is the cumulative GPA requirement?",
    "when is the final exam?",
    "how many absences are allowed?",
    "كيف أسجل في المقررات؟",
    "ما هي سياسة الواجبات؟",
    "how do I submit an assignment?",
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


def test_a_question_about_the_students_gpa_stays_its_own_tool():
    assert detect_personal_tool("ما معدلي") == "get_gpa"


def test_a_question_about_the_students_own_lms_data_is_its_own_tool():
    """The LMS tools answer from the LMS, not from Edugate."""
    assert detect_personal_tool("درجاتي في البلاك بورد") == "get_lms_grades"
    assert detect_personal_tool("my grades on blackboard") == "get_lms_grades"
    assert detect_personal_tool("درجاتي") == "get_grades"


def test_a_question_about_a_programmes_requirement_hours_is_not_a_tool():
    """The requirement hours of a programme are regulation, not the student's progress."""
    assert detect_personal_tool("ما هي متطلبات الجامعة؟") is None
    assert detect_personal_tool("كم ساعة يحتاج التخرج في هندسة البرمجيات؟") is None

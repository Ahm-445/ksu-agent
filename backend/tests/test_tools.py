"""Detection of questions about the student's own data — no model, no I/O.

`detect_personal_tool` decides which tool the website should run. It must fire only
for a question about the student's *own* data: the regulation questions that talk
about "المعدل التراكمي" or "شروط الحرمان" in general must stay ordinary answers.
"""

import pytest

from app.tools import detect_personal_request, detect_personal_tool

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
        "ما مقرراتي في البلاك بورد؟",
        "my courses",
        "what are my lms courses?",
        "my courses on LMS",
    ],
    "get_assignments": [
        "وش واجباتي؟",
        "واجباتي",
        "واجباتي القادمة",
        "ما الواجبات القادمة؟",
        "وش علي تسليمات",
        "متى تسليم الواجب",
        "ايش المطلوب مني هالاسبوع",
        "متى تسليماتي؟",
        "my assignments",
        "what is due this week?",
        "what's due",
        "upcoming assignments",
    ],
    "get_lms_grades": [
        "درجاتي في البلاك بورد",
        "وش درجاتي في lms؟",
        "درجة الميدترم",
        "درجات الواجبات",
        "كم جبت في الكويز",
        "my grades on blackboard",
        "my lms grades",
        "my LMS grades",
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
    "كيف أسلم واجب في البلاك بورد؟",
    "ما هي سياسة تأخير تسليم الواجبات؟",
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


LMS_PHRASES = [
    ("ما الواجبات القادمة؟", "get_assignments"),
    ("وش علي تسليمات", "get_assignments"),
    ("متى تسليم الواجب", "get_assignments"),
    ("واجباتي", "get_assignments"),
    ("ايش المطلوب مني هالاسبوع", "get_assignments"),
    ("what's due", "get_assignments"),
    ("upcoming assignments", "get_assignments"),
    ("درجاتي في البلاك بورد", "get_lms_grades"),
    ("درجة الميدترم", "get_lms_grades"),
    ("درجات الواجبات", "get_lms_grades"),
    ("كم جبت في الكويز", "get_lms_grades"),
    ("my LMS grades", "get_lms_grades"),
    ("ما مقرراتي في البلاك بورد؟", "get_courses"),
    ("my courses on LMS", "get_courses"),
    ("ما درجاتي؟", "get_grades"),
    ("ما جدولي؟", "get_schedule"),
    ("كيف أسلم واجب في البلاك بورد؟", None),
    ("ما هي سياسة تأخير تسليم الواجبات؟", None),
]


@pytest.mark.parametrize(("message", "tool"), LMS_PHRASES)
def test_each_lms_question_routes_to_its_own_tool(message, tool):
    assert detect_personal_tool(message) == tool


def test_a_question_about_the_students_own_lms_data_is_its_own_tool():
    """The LMS tools answer from the LMS, not from Edugate."""
    assert detect_personal_tool("درجاتي في البلاك بورد") == "get_lms_grades"
    assert detect_personal_tool("my grades on blackboard") == "get_lms_grades"
    assert detect_personal_tool("درجاتي") == "get_grades"


def test_a_question_about_a_programmes_requirement_hours_is_not_a_tool():
    """The requirement hours of a programme are regulation, not the student's progress."""
    assert detect_personal_tool("ما هي متطلبات الجامعة؟") is None
    assert detect_personal_tool("كم ساعة يحتاج التخرج في هندسة البرمجيات؟") is None

# A reasoning question needs values, not one page: the website runs every tool here and
# asks the student before sending them (ADR 0001, rule 5).
REASONING = [
    ("هل أقدر أتخرج الفصل القادم؟", ("get_plan_progress", "get_gpa")),
    ("متى أتخرج؟", ("get_plan_progress", "get_gpa")),
    ("هل أنا قريب من الحرمان؟", ("get_absences",)),
    ("كم غياب باقي لي قبل الحرمان في 434", ("get_absences",)),
    ("كم أحتاج أجيب عشان يصير معدلي 4.5؟", ("get_gpa",)),
    ("هل أنا تحت الإنذار؟", ("get_gpa",)),
    ("هل عندي تعارض في الاختبارات النهائية؟", ("get_final_exams",)),
    ("كيف أوزع وقتي هالأسبوع؟", ("get_assignments", "get_schedule")),
    ("plan my week", ("get_assignments", "get_schedule")),
    ("Can I graduate next term?", ("get_plan_progress", "get_gpa")),
    ("When will I graduate?", ("get_plan_progress", "get_gpa")),
    ("Am I close to being barred?", ("get_absences",)),
    (
        "How many absences do I have left before being barred in 434?",
        ("get_absences",),
    ),
    ("What do I need to raise my GPA to 4.5?", ("get_gpa",)),
    ("Am I on academic warning?", ("get_gpa",)),
]


@pytest.mark.parametrize(("message", "tools"), REASONING)
def test_a_reasoning_question_names_its_tools(message, tools):
    request = detect_personal_request(message)

    assert request is not None
    assert request.reasoning is True
    assert request.tools == tools


def test_a_factual_question_is_still_a_single_tool_reply():
    request = detect_personal_request("ما معدلي")

    assert request is not None
    assert request.reasoning is False
    assert request.tools == ("get_gpa",)


@pytest.mark.parametrize(
    "message",
    ["ما شروط الحرمان؟", "ما شروط التخرج؟", "كيف يُحسب المعدل التراكمي؟"],
)
def test_a_general_regulation_question_is_not_a_request(message):
    """The rules about deprivation and graduation are regulation, not the student's data."""
    assert detect_personal_request(message) is None


@pytest.mark.parametrize(
    "message",
    ["متى الواجب القادم في مادة 444", "هل عندي اختبار بكرة"],
)
def test_a_question_about_what_is_due_is_a_single_assignments_tool(message):
    request = detect_personal_request(message)

    assert request is not None
    assert request.reasoning is False
    assert request.tools == ("get_assignments",)

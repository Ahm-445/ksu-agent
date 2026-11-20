"""ADR 0001 rule 2, audited end to end: a personal value never reaches a log or an error body.

Every field of every tool's data carries its own sentinel, and every path of both endpoints is driven
through TestClient with all logging at DEBUG: the root logger and the ones uvicorn, FastAPI and httpx log to,
each record formatted with its exception text. A sentinel may appear in the 200 answer — that is the answer the
student asked for — and nowhere else: never in a log record, never in the body of an error, and the question of
`/chat/with-data` is never logged at all.

The sentinels are the only values in the data, so a leak has nowhere to hide: if a value reaches a log line or a
4xx/5xx body, one of these strings is in it.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import answer
from app import main
from app.auth.routes import require_user
from app.auth.store import User
from app.tools import REASONING_TOOLS
from app.with_data import TOOL_SCHEMAS

from test_answer import (
    ABSENCE_TEXT,
    GRADUATION_TEXT,
    FakeChatClient,
    FakeRetriever,
    make_result,
    reply,
    write_config,
)

# One sentinel per field, so a leak names the field it came from.
SENT = {
    "gpa": "SENT-GPA-9q",
    "scale": "SENT-SCALE-2m",
    "term": "SENT-TERM-3b",
    "name": "SENT-NAME-4k",
    "code": "SENT-CODE-5v",
    "title": "SENT-TITLE-7z",
    "day": "SENT-DAY-8p",
    "date": "SENT-DATE-6c",
    "time": "SENT-TIME-1x",
    "location": "SENT-LOC-0r",
    "section": "SENT-SECT-9w",
    "activity": "SENT-ACT-4h",
    "start": "SENT-START-8j",
    "end": "SENT-END-4w",
    "group": "SENT-GROUP-7n",
    "type": "SENT-TYPE-2d",
    "level": "SENT-LEVEL-6t",
    "grade": "SENT-GRADE-5y",
    "status": "SENT-STATUS-3f",
    "due": "SENT-DUE-9d",
}
SENTINELS = tuple(SENT.values())

# The question itself is never logged by /chat/with-data.
QUESTION_SENTINEL = "SENT-Q-6k"

# A valid timestamp, so the week plan has a due item next to the sentinel ones.
DUE_AT = "2026-11-21T23:59:00+03:00"

TOOL_DATA: dict[str, dict] = {
    "get_gpa": {
        "cumulative_gpa": SENT["gpa"],
        "scale": SENT["scale"],
        "earned_hours": 96,
        "registered_hours": 99,
        "as_of_term": SENT["term"],
    },
    "get_absences": {
        "courses": [
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "absence_percent": 30,
                "absences": 3,
                "lates": 0,
            }
        ]
    },
    "get_final_exams": {
        "exams": [
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "day": SENT["day"],
                "date": SENT["date"],
                "time": SENT["time"],
                "location": SENT["location"],
            }
        ]
    },
    "get_schedule": {
        "term": SENT["term"],
        "classes": [
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "activity": SENT["activity"],
                "section": SENT["section"],
                "days": [1, 3],
                "start": SENT["start"],
                "end": SENT["end"],
            },
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "activity": SENT["activity"],
                "section": SENT["section"],
                "days": [1],
                "start": "08:00",
                "end": "09:50",
            },
        ],
    },
    "get_grades": {
        "term": SENT["term"],
        "courses": [
            {"code": SENT["code"], "name": SENT["name"], "grade": SENT["grade"]}
        ],
    },
    "get_plan_progress": {
        "completed_hours": 96,
        "remaining_hours": 3,
        "remaining_courses": [
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "hours": 3,
                "group": SENT["group"],
                "type": SENT["type"],
                "level": SENT["level"],
            }
        ],
    },
    "get_courses": {
        "courses": [
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "sections": [SENT["section"]],
            }
        ]
    },
    "get_assignments": {
        "items": [
            {"title": SENT["title"], "course": SENT["name"], "due_at": SENT["due"]},
            {"title": SENT["title"], "course": SENT["name"], "due_at": DUE_AT},
        ]
    },
    "get_lms_grades": {
        "courses": [
            {
                "code": SENT["code"],
                "name": SENT["name"],
                "items": [
                    {
                        "title": SENT["title"],
                        "score": 8.5,
                        "possible": 10,
                        "status": SENT["status"],
                    }
                ],
            }
        ]
    },
}

# Every reasoning kind, the question that asks it, and the tools its data holds.
KINDS = [
    ("graduation", "هل أقدر أتخرج الفصل القادم؟", ("get_plan_progress", "get_gpa")),
    ("absences", "هل أنا قريب من الحرمان؟", ("get_absences",)),
    ("gpa_target", "كم أحتاج أجيب عشان يصير معدلي 4.5؟", ("get_gpa",)),
    ("academic_warning", "هل أنا تحت الإنذار؟", ("get_gpa",)),
    ("exam_conflicts", "هل عندي تعارض في الاختبارات النهائية؟", ("get_final_exams",)),
    ("plan_week", "كيف أوزع وقتي هالأسبوع؟", ("get_assignments", "get_schedule")),
]

SOURCE = answer.SourceRef(
    title="لائحة الدراسة والاختبارات", url="https://dar.ksu.edu.sa/regulations.pdf"
)

SIGNED_IN = User(
    id="u-1",
    full_name="Test Student",
    email="444100001@student.ksu.edu.sa",
    password_hash="scrypt$unused",
    lang="ar",
    email_verified=True,
)

# Every logger a request can reach, the root logger included. uvicorn's ServerErrorMiddleware logs
# an unhandled exception's traceback on "uvicorn.error", which is why that one is captured too.
AUDITED_LOGGERS = (
    "",
    "uvicorn",
    "uvicorn.error",
    "uvicorn.access",
    "fastapi",
    "httpx",
)


class _Collector(logging.Handler):
    """Collects each record as its formatter writes it: message, arguments, exception text."""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.setFormatter(logging.Formatter("%(name)s %(levelname)s %(message)s"))
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(self.format(record))


class AllLogs:
    """Every record the audited loggers emit at DEBUG, with any traceback attached."""

    def __init__(self) -> None:
        self.collector = _Collector()
        self.levels: dict[str, int] = {}

    def __enter__(self) -> "AllLogs":
        for name in AUDITED_LOGGERS:
            logger = logging.getLogger(name)
            self.levels[name] = logger.level
            logger.setLevel(logging.DEBUG)
            logger.addHandler(self.collector)
        return self

    def __exit__(self, *_exc_info) -> None:
        for name in AUDITED_LOGGERS:
            logger = logging.getLogger(name)
            logger.removeHandler(self.collector)
            logger.setLevel(self.levels[name])

    @property
    def text(self) -> str:
        return "\n".join(self.collector.lines)


def assert_no_sentinel(text: str, where: str) -> None:
    for sentinel in SENTINELS:
        assert sentinel not in text, f"{sentinel} reached {where}"


@pytest.fixture
def api(tmp_path, monkeypatch):
    """A TestClient whose retriever, model, config and sign-in are fakes.

    raise_server_exceptions is off so an unhandled error is the response the student would see,
    not an exception raised into the test.
    """

    def make(content=None, error=None):
        chat_client = FakeChatClient(
            content if content is not None else reply(True, "الجواب (المادة 62)."),
            error,
        )
        retriever = FakeRetriever(
            [
                make_result(24, GRADUATION_TEXT),
                make_result(25, ABSENCE_TEXT),
                make_result(62, GRADUATION_TEXT),
            ]
        )
        config = answer.load_config(write_config(tmp_path / "chat.toml"))

        monkeypatch.setattr(main, "get_retriever", lambda: retriever)
        monkeypatch.setattr(main, "get_client", lambda: chat_client)
        monkeypatch.setattr(main, "get_config", lambda: config)
        monkeypatch.setattr(main, "get_source", lambda: SOURCE)
        monkeypatch.setitem(main.app.dependency_overrides, require_user, lambda: SIGNED_IN)

        return TestClient(main.app, raise_server_exceptions=False)

    yield make


# --- the audit covers what it claims to ------------------------------------


def test_every_tool_and_every_reasoning_kind_is_covered():
    """The audit cannot silently drift: a new tool or kind must be added here too."""
    assert set(TOOL_DATA) == set(TOOL_SCHEMAS)
    assert {kind for kind, _message, _tools in KINDS} == set(REASONING_TOOLS)

    for _kind, _message, tools in KINDS:
        assert set(tools) <= set(TOOL_DATA)


def test_the_capture_sees_a_sentinel_at_debug_including_a_traceback():
    """A collector that missed records would make every other test here pass for nothing."""
    with AllLogs() as logs:
        for name in AUDITED_LOGGERS:
            logging.getLogger(name).debug("leaked %s", SENT["gpa"])
        logging.getLogger("uvicorn.error").error(
            "Exception in ASGI application", exc_info=RuntimeError(SENT["name"])
        )

    assert SENT["gpa"] in logs.text
    # The formatted traceback, not just the record's message.
    assert SENT["name"] in logs.text


# --- /chat -----------------------------------------------------------------


def test_a_tool_reply_never_leaks_the_question(api):
    client = api()
    question = f"ما معدلي التراكمي {QUESTION_SENTINEL}؟"

    with AllLogs() as logs:
        response = client.post("/chat", json={"message": question})

    assert response.status_code == 200
    assert response.json() == {"type": "tool", "tool": "get_gpa", "args": {}}
    assert_no_sentinel(response.text, "the tool reply")
    assert_no_sentinel(logs.text, "the log")
    assert question not in logs.text


def test_a_reason_reply_never_leaks_the_question(api):
    client = api()
    question = f"هل أقدر أتخرج الفصل القادم {QUESTION_SENTINEL}؟"

    with AllLogs() as logs:
        response = client.post("/chat", json={"message": question})

    assert response.status_code == 200
    assert response.json() == {
        "type": "reason",
        "tools": ["get_plan_progress", "get_gpa"],
    }
    assert_no_sentinel(response.text, "the reason reply")
    assert_no_sentinel(logs.text, "the log")
    assert question not in logs.text


def test_a_regulation_answer_never_leaks_the_question(api):
    client = api(content=reply(True, "الحد الأدنى 2,75 (المادة 62)."))
    question = f"كم المعدل المطلوب عشان أتخرج {QUESTION_SENTINEL}؟"

    with AllLogs() as logs:
        response = client.post("/chat", json={"message": question})

    assert response.status_code == 200
    assert_no_sentinel(response.text, "the answer")
    assert_no_sentinel(logs.text, "the log")


def test_a_failed_regulation_answer_never_leaks_the_question(api):
    client = api(error=RuntimeError(f"provider said no to {QUESTION_SENTINEL}"))
    question = f"كم المعدل المطلوب عشان أتخرج {QUESTION_SENTINEL}؟"

    with AllLogs() as logs:
        response = client.post("/chat", json={"message": question})

    assert response.status_code == 503
    assert_no_sentinel(response.text, "the 503 body")
    assert_no_sentinel(logs.text, "the log")


# --- /chat/with-data: every kind -------------------------------------------


@pytest.mark.parametrize(("kind", "message", "tools"), KINDS)
def test_a_kind_answers_from_its_values_and_never_logs_them(api, kind, message, tools):
    client = api(content=reply(True, "سلّم الواجبات أول الأسبوع."))
    data = {tool: TOOL_DATA[tool] for tool in tools}
    question = f"{message} {QUESTION_SENTINEL}"

    assert main.detect_reasoning_kind(question) == kind

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data", json={"message": question, "data": data}
        )

    assert response.status_code == 200
    assert response.json()["type"] == "answer"
    assert_no_sentinel(logs.text, "the log")
    assert question not in logs.text
    assert QUESTION_SENTINEL not in logs.text


def test_the_answer_itself_is_the_only_place_a_value_may_appear(api):
    """The audit is not vacuous: this template answer really does carry the sentinel."""
    client = api()

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data",
            json={"message": KINDS[1][1], "data": {"get_absences": TOOL_DATA["get_absences"]}},
        )

    assert response.status_code == 200
    assert SENT["name"] in response.json()["answer"]
    assert_no_sentinel(logs.text, "the log")


# --- /chat/with-data: every 422 code ---------------------------------------


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"message": "", "data": {"get_gpa": TOOL_DATA["get_gpa"]}}, "message_empty"),
        (
            {"message": "   ", "data": {"get_gpa": TOOL_DATA["get_gpa"]}},
            "message_empty",
        ),
        ({"message": "س" * 1001, "data": {"get_gpa": TOOL_DATA["get_gpa"]}},
         "message_too_long"),
        ({"message": KINDS[0][1]}, "data_missing"),
        ({"message": KINDS[0][1], "data": {}}, "data_missing"),
        (
            {"message": KINDS[0][1], "data": {"get_gpa": TOOL_DATA["get_gpa"]}},
            "data_missing",
        ),
        (
            {
                "message": KINDS[0][1],
                "data": {
                    "get_gpa": TOOL_DATA["get_gpa"],
                    "get_plan_progress": TOOL_DATA["get_plan_progress"],
                    "get_schedule": TOOL_DATA["get_schedule"],
                },
            },
            "unknown_tool",
        ),
        (
            {
                "message": KINDS[0][1],
                "data": {
                    "get_gpa": {**TOOL_DATA["get_gpa"], "extra": SENT["gpa"]},
                    "get_plan_progress": TOOL_DATA["get_plan_progress"],
                },
            },
            "data_invalid",
        ),
        (
            {
                "message": KINDS[0][1],
                "data": {
                    "get_gpa": {**TOOL_DATA["get_gpa"], "scale": 5},
                    "get_plan_progress": TOOL_DATA["get_plan_progress"],
                },
            },
            "data_invalid",
        ),
    ],
)
def test_a_rejected_body_is_a_code_and_never_the_body(api, body, code):
    client = api()

    with AllLogs() as logs:
        response = client.post("/chat/with-data", json=body)

    assert response.status_code == 422
    assert response.json() == {"detail": code}
    assert_no_sentinel(response.text, "the 422 body")
    assert_no_sentinel(logs.text, "the log")


def test_a_data_field_of_the_wrong_shape_is_a_code_not_the_value(api):
    """FastAPI's own 422 body carries the offending input; on this path it never may."""
    client = api()

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data",
            json={"message": KINDS[0][1], "data": SENT["gpa"]},
        )

    assert response.status_code == 422
    assert_no_sentinel(response.text, "the 422 body")
    assert_no_sentinel(logs.text, "the log")


def test_a_body_that_is_not_json_is_a_code_not_the_body(api):
    client = api()

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data",
            content=f'{{"message": "{KINDS[0][1]}", "data": "{SENT["gpa"]}"'.encode(),
            headers={"Content-Type": "application/json"},
        )

    assert response.status_code == 422
    assert_no_sentinel(response.text, "the 422 body")
    assert_no_sentinel(logs.text, "the log")


def test_a_body_over_twenty_kilobytes_is_a_code_and_never_the_body(api):
    client = api()
    data = {
        "get_gpa": {**TOOL_DATA["get_gpa"], "as_of_term": SENT["term"] * 2500},
        "get_plan_progress": TOOL_DATA["get_plan_progress"],
    }

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data", json={"message": KINDS[0][1], "data": data}
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "data_too_large"}
    assert_no_sentinel(response.text, "the 422 body")
    assert_no_sentinel(logs.text, "the log")


def test_with_data_without_a_session_is_401_and_carries_nothing(api):
    client = api()

    def unauthenticated():
        raise HTTPException(status_code=401, detail="unauthenticated")

    main.app.dependency_overrides[require_user] = unauthenticated

    try:
        with AllLogs() as logs:
            response = client.post(
                "/chat/with-data",
                json={"message": KINDS[1][1], "data": {"get_absences": TOOL_DATA["get_absences"]}},
            )
    finally:
        main.app.dependency_overrides[require_user] = lambda: SIGNED_IN

    assert response.status_code == 401
    assert_no_sentinel(response.text, "the 401 body")
    assert_no_sentinel(logs.text, "the log")


def test_a_model_failure_is_a_503_that_carries_no_value(api):
    client = api(error=RuntimeError(f"provider said no to {SENT['name']}"))
    data = {
        "get_assignments": TOOL_DATA["get_assignments"],
        "get_schedule": TOOL_DATA["get_schedule"],
    }

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data", json={"message": KINDS[5][1], "data": data}
        )

    assert response.status_code == 503
    assert_no_sentinel(response.text, "the 503 body")
    assert_no_sentinel(logs.text, "the log")


def test_an_unexpected_exception_is_a_503_that_carries_no_value(api, monkeypatch):
    client = api()

    def unexpected(*_args, **_kwargs):
        raise TypeError(f"x {SENT['gpa']}")

    monkeypatch.setattr(answer, "answer_question", unexpected)

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data",
            json={"message": KINDS[5][1], "data": {
                "get_assignments": TOOL_DATA["get_assignments"],
                "get_schedule": TOOL_DATA["get_schedule"],
            }},
        )

    assert response.status_code == 503
    assert_no_sentinel(response.text, "the 503 body")
    assert_no_sentinel(logs.text, "the log")
    assert not any(
        "Exception in ASGI application" in line for line in logs.collector.lines
    )


def test_an_unexpected_exception_while_computing_the_facts_carries_no_value(
    api, monkeypatch
):
    """The facts are computed before the answer; a failure there is a 503 like any other."""
    client = api()

    def unexpected(*_args, **_kwargs):
        raise TypeError(f"x {SENT['gpa']}")

    monkeypatch.setattr(main.facts, "build_facts", unexpected)

    with AllLogs() as logs:
        response = client.post(
            "/chat/with-data",
            json={"message": KINDS[1][1], "data": {"get_absences": TOOL_DATA["get_absences"]}},
        )

    assert response.status_code == 503
    assert_no_sentinel(response.text, "the 503 body")
    assert_no_sentinel(logs.text, "the log")

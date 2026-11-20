"""HTTP API for KSU Agent.

Two endpoints, exactly as written in docs/api-contract.md: POST /chat answers a question
with an Arabic answer plus the regulation articles it cites, or names the tools the
website runs; POST /chat/with-data answers a reasoning question from the values the
student approved sending. Retrieval and generation live in backend/scripts (retrieve.py,
answer.py); this module validates the request and maps failures to status codes. The API
key is read from .env by answer.make_client and never appears in a response or a log line.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

import answer
from app import facts
from app.auth.routes import require_user, router as auth_router
from app.tools import (
    detect_personal_request,
    detect_reasoning_kind,
    detect_reasoning_tools,
)
from app.with_data import DataError, data_size, validate_data

LOGGER = logging.getLogger(__name__)

app = FastAPI(title="KSU Agent", version="0.1.0")

# The front-end dev server is the only browser origin allowed, and it sends
# cookies, so the origin is named exactly and never "*": a wildcard with
# credentials is rejected by browsers and would let any page call the API.
# Methods and headers are listed explicitly for the same reason.
ALLOWED_ORIGINS = ["http://localhost:3000"]
ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
ALLOWED_HEADERS = ["Content-Type", "Accept"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=ALLOWED_METHODS,
    allow_headers=ALLOWED_HEADERS,
)

app.include_router(auth_router)

# The whole body of a reasoning answer is small: one entry per tool the reply named,
# with the fields the contract lists. A body over this is refused before it is parsed.
MAX_WITH_DATA_BYTES = 20 * 1024

# The two endpoints whose validation failures answer with a short code.
ANSWER_PATHS = ("/chat", "/chat/with-data")


@app.middleware("http")
async def _refuse_oversized_with_data(request, call_next):
    """A body over the contract's limit is a 422 with a code, not a parse attempt."""
    if request.method == "POST" and request.url.path == "/chat/with-data":
        body = await request.body()
        if len(body) > MAX_WITH_DATA_BYTES:
            LOGGER.info("rejected a with-data request: data_too_large")
            return JSONResponse(
                status_code=422, content={"detail": "data_too_large"}
            )
    return await call_next(request)


def _message_validation_code(exc: RequestValidationError) -> str | None:
    """The short code for a bad `message`, or None for any other failure.

    The front-end switches on these codes, so the body is `{"detail": "<code>"}`
    and never a sentence: `message_empty` for an absent, empty or blank question,
    `message_too_long` for one over the contract's limit.
    """
    for error in exc.errors():
        if "message" not in error.get("loc", ()):
            continue
        if error.get("type") == "string_too_long":
            return "message_too_long"
        if error.get("type") in {"value_error", "missing"}:
            return "message_empty"
    return None


def _validation_code(exc: RequestValidationError) -> str:
    """The short code for a rejected body, whatever field it was.

    FastAPI's own 422 body repeats the offending input, and on /chat/with-data that input is
    a value the student approved for one answer (ADR 0001, rule 2), so both answer paths
    always answer with a code: `data_invalid` for a `data` the contract does not allow,
    `bad_request` for anything else, such as a body that is not JSON.
    """
    code = _message_validation_code(exc)
    if code is not None:
        return code
    if any("data" in error.get("loc", ()) for error in exc.errors()):
        return "data_invalid"
    return "bad_request"


@app.exception_handler(RequestValidationError)
async def _chat_validation_error(request, exc: RequestValidationError):
    """Answer a chat validation failure with a code; leave everything else alone."""
    if request.url.path in ANSWER_PATHS:
        code = _validation_code(exc)
        LOGGER.info("rejected a request to %s: %s", request.url.path, code)
        return JSONResponse(status_code=422, content={"detail": code})
    return await request_validation_exception_handler(request, exc)


class ChatRequest(BaseModel):
    """The request body from docs/api-contract.md."""

    message: str = Field(..., max_length=answer.MAX_QUESTION_CHARS)
    # Accepted so a client can keep its conversation id; the endpoint keeps no
    # history yet, so the value is not used.
    session_id: str | None = Field(default=None, max_length=128)

    @field_validator("message")
    @classmethod
    def _message_is_not_blank(cls, value: str) -> str:
        """An empty or whitespace-only question is a 422, not a model call."""
        message = value.strip()
        if not message:
            raise ValueError("message_empty")
        return message


class WithDataRequest(ChatRequest):
    """`/chat/with-data`: the question, and the values the website read for it.

    `data` is one entry per tool the `/chat` reply named; `validate_data` checks the keys
    against that list and each value against the tool's contract fields.
    """

    data: dict[str, Any] = Field(default_factory=dict)

class CitationModel(BaseModel):
    """One cited article, in the contract's field order."""

    title: str
    article: int | None
    url: str


class ChatResponse(BaseModel):
    """An answer, in the contract's field order.

    `basis` says what the answer rests on: "regulation" when the regulation answers the question,
    "student_data" when the student's own numbers are all there is, so the website can say so
    before the student reads a number that no article supports.
    """

    type: Literal["answer"] = "answer"
    answer: str
    citations: list[CitationModel]
    basis: Literal["regulation", "student_data"] = "regulation"


class ToolResponse(BaseModel):
    """A tool the website runs in the student's browser, in the contract's order.

    The backend names the tool and nothing else: the values are read and kept on the
    student's device (ADR 0001), so this body never carries them.
    """

    type: Literal["tool"] = "tool"
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class ReasonResponse(BaseModel):
    """The tools a reasoning question needs, in the contract's order.

    Also nothing but names: the website runs these tools, shows the student what would
    be sent, and asks for consent for this one question (ADR 0001, rule 5).
    """

    type: Literal["reason"] = "reason"
    tools: list[str]


@lru_cache
def get_config() -> answer.ChatConfig:
    """The chat config, read from backend/config/chat.toml once."""
    return answer.load_config()


@lru_cache
def get_retriever() -> answer.Retriever:
    """The retriever for the configured source; the index loads on first use."""
    return answer.make_searcher(get_config().source_id)


@lru_cache
def get_source() -> answer.SourceRef | None:
    """The regulation's title and URL from sources.toml, for citing an article retrieval missed."""
    return answer.load_source(get_config().source_id)


@lru_cache
def get_client():
    """The chat client; the key is read from .env here and nowhere else."""
    return answer.make_client(get_config())


@lru_cache
def get_reasoning() -> facts.ReasoningConfig:
    """The reasoning thresholds and fixed queries, read from reasoning.toml once."""
    return facts.load_config()


@app.post(
    "/chat",
    response_model=ChatResponse | ToolResponse | ReasonResponse,
    dependencies=[Depends(require_user)],
)
def chat(request: ChatRequest) -> ChatResponse | ToolResponse | ReasonResponse:
    """Answer one question: a tool request, a reasoning request, or an answer.

    Only for a signed-in student: require_user answers 401 before this runs.
    """
    # A question about the student's own data becomes a tool or reasoning request, and
    # the values are read in their browser: no retrieval, no model, nothing personal
    # here. Only tool names are logged — never the question, never a value.
    personal = detect_personal_request(request.message)

    if personal is not None and personal.reasoning:
        LOGGER.info("answered a reasoning question with the tools %s", personal.tools)
        return ReasonResponse(tools=list(personal.tools))

    if personal is not None:
        LOGGER.info("answered a question with the tool %s", personal.tools[0])
        return ToolResponse(tool=personal.tools[0])

    # Built here rather than through Depends: FastAPI solves dependencies before
    # the request body, so a dependency would load the index and the model client
    # for a body it then rejects with a 422. Called after validation, a rejected
    # request costs nothing.
    retriever = get_retriever()
    client = get_client()
    try:
        result = answer.answer_question(
            request.message,
            retriever=retriever,
            client=client,
            config=get_config(),
            source=get_source(),
        )
    except answer.ModelUnavailable as exc:
        LOGGER.error("chat failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="the answer service is unavailable; please try again",
        ) from exc
    except (OSError, ValueError, RuntimeError) as exc:
        # Retrieval or index trouble: say the service is down rather than answer
        # without the regulation behind it.
        LOGGER.error("chat failed: %s: %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=503,
            detail="the answer service is unavailable; please try again",
        ) from exc
    LOGGER.info(
        "answered a %d-character question with %d citation(s)",
        len(request.message),
        len(result.citations),
    )
    return _answer_response(result)


def _answer_response(
    result: answer.Answer, basis: Literal["regulation", "student_data"] = "regulation"
) -> ChatResponse:
    """The contract's answer body, in its field order."""
    return ChatResponse(
        answer=result.answer,
        basis=basis,
        citations=[
            CitationModel(
                title=citation.title,
                article=citation.article,
                url=citation.url,
            )
            for citation in result.citations
        ],
    )


@app.post(
    "/chat/with-data",
    response_model=ChatResponse,
    dependencies=[Depends(require_user)],
)
def chat_with_data(request: WithDataRequest) -> ChatResponse:
    """Answer one reasoning question from the student's own values.

    The body carries the values the website read in the browser, once, after the student
    approved this one question (ADR 0001, rule 5). Only tool names, the size of the data and
    the latency are logged: never the question, never a value, and never the text of an error.

    A verdict kind (absences, academic warning, graduation, GPA target, exam clash) is answered
    from the computed numbers and the template, with no model call at all.
    """
    started = time.monotonic()

    kind = detect_reasoning_kind(request.message)

    try:
        data = validate_data(request.data, detect_reasoning_tools(request.message))
    except DataError as exc:
        LOGGER.info("rejected a with-data request: %s", exc.code)
        raise HTTPException(status_code=422, detail=exc.code) from exc

    # Everything that touches the values runs inside the try, the fact computation included: an
    # unexpected error there is the same 503 as one from the answer, and only the exception's
    # type is logged, because an error's message can carry a value from the prompt and uvicorn
    # logs a chained traceback with it.
    try:
        # The numbers are computed here, in code, and never by the model: the answer explains
        # them and states no other number (app/facts.py). The extra queries are the kind's
        # fixed ones, so no value of the student's is ever part of a query.
        reasoning = get_reasoning()
        computed = facts.build_facts(kind, data, reasoning.thresholds, request.message)
        extra_queries = reasoning.retrieval.get(kind, ()) if kind else ()
        needs_regulation = facts.needs_regulation(kind)

        # A verdict kind is answered from the template and the computed numbers alone: there is
        # nothing for the model to phrase and nothing it could get wrong, so it is never called
        # and the client is not even built. Retrieval still runs, for the citations.
        if answer.is_verdict_kind(kind):
            result = answer.answer_from_facts(
                kind,
                request.message,
                retriever=get_retriever(),
                facts=computed,
                needs_regulation=needs_regulation,
                extra_queries=extra_queries,
                source=get_source(),
            )
        else:
            result = answer.answer_question(
                request.message,
                retriever=get_retriever(),
                client=get_client(),
                config=get_config(),
                student_data=data,
                facts=computed,
                extra_queries=extra_queries,
                needs_regulation=needs_regulation,
                source=get_source(),
            )
    except Exception as exc:
        LOGGER.error("with-data failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail="the answer service is unavailable; please try again",
        ) from None

    LOGGER.info(
        "answered a %s question with %s (%d bytes of data) in %d ms",
        kind,
        ", ".join(data),
        data_size(data),
        round((time.monotonic() - started) * 1000),
    )
    return _answer_response(
        result, "regulation" if needs_regulation else "student_data"
    )

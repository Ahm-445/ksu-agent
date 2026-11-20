"""The router evaluation set — every question in eval/phase2_router.json must route.

`test_tools.py` proves each pattern with a handful of sentences. This set is the breadth:
101 questions a student would actually type, across MSA, Hijazi, Najdi, Gulf and English,
each with the routing `/chat` promises for it. It is the specification the patterns are
widened against, so a pattern that starts matching one of them wrongly, or stops matching
one of them at all, fails here.

The three kinds are the three answers `/chat` can give: `regulation` (no tool: retrieval and
the model answer it), `tool` (one page, answered in the browser) and `reason` (one to three
pages, compared after the student's consent).

No sentence is special-cased in the router to pass this set: a failure is fixed in the
pattern, never by matching the question's exact text.

A question the set treats as genuinely ambiguous carries `accept`, the routes a student could
reasonably mean, in place of one `expected` route, and `ambiguous_reason` saying why; it passes
when the router takes any of them. The share of such items is capped, so the set cannot drift
into accepting everything.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.tools import detect_personal_request, detect_reasoning_kind

EVAL_PATH = Path(__file__).resolve().parents[2] / "eval" / "phase2_router.json"

# The whole catalogue and every reasoning kind: a set that misses one of them says nothing
# about the questions that reach it.
TOOLS = (
    "get_gpa",
    "get_grades",
    "get_lms_grades",
    "get_schedule",
    "get_final_exams",
    "get_absences",
    "get_plan_progress",
    "get_courses",
    "get_assignments",
)
REASONING_KINDS = (
    "graduation",
    "absences",
    "gpa_target",
    "academic_warning",
    "exam_conflicts",
    "plan_week",
)

MIN_ITEMS = 80
MIN_REGULATION_ITEMS = 24

# At most one item in twenty may accept several routes: a set that accepts everything
# measures nothing, and this cap is what keeps `accept` from spreading.
MAX_AMBIGUOUS_SHARE = 0.05


def load_items() -> list[dict]:
    """The set as shipped, read at import so a missing or broken file fails loudly."""
    return json.loads(EVAL_PATH.read_text(encoding="utf-8"))


ITEMS = load_items()


def expected_route(item: dict) -> str:
    """The one route the set expects, in the same vocabulary the runner uses."""
    expected = item["expected"]

    if expected["kind"] == "regulation":
        return "regulation"
    if expected["kind"] == "reason":
        return f"reason:{expected['reasoning']}"

    return expected["tools"][0]


def accepted_routes(item: dict) -> tuple[str, ...]:
    """Every route the set accepts: one, or the several a genuinely ambiguous item names."""
    if "accept" in item:
        return tuple(item["accept"])

    return (expected_route(item),)


@dataclass(frozen=True)
class Routing:
    """One question's routing, next to the routes the set accepts for it."""

    id: str
    question: str
    accepted: tuple[str, ...]
    expected_kind: str | None
    expected_tools: tuple[str, ...]
    expected_reasoning: str | None
    kind: str
    tools: tuple[str, ...]
    reasoning: str | None

    @property
    def route(self) -> str:
        """The route the regex took, in the same vocabulary the set is written in."""
        if self.kind == "regulation":
            return "regulation"
        if self.kind == "reason":
            return f"reason:{self.reasoning}"

        return self.tools[0]

    @property
    def problem(self) -> str | None:
        """What differs from the expectation, or None when the router agrees with it."""
        if self.route in self.accepted:
            return None

        # An ambiguous item names no single route, so there is nothing to compare field by field.
        if self.expected_kind is None:
            return f"route: expected one of {list(self.accepted)}, got {self.route}"

        if self.kind != self.expected_kind:
            return f"kind: expected {self.expected_kind}, got {self.kind}"

        if self.kind != "regulation" and self.tools != self.expected_tools:
            return f"tools: expected {list(self.expected_tools)}, got {list(self.tools)}"

        if self.kind == "reason" and self.reasoning != self.expected_reasoning:
            return (
                f"reasoning: expected {self.expected_reasoning}, got {self.reasoning}"
            )

        return None


def route(item: dict) -> Routing:
    """Run the endpoint's entry point over one question and record what it decided."""
    request = detect_personal_request(item["question"])
    expected = item.get("expected", {})

    if request is None:
        kind, tools = "regulation", ()
    else:
        # A factual question is answered in the browser from one page; a reasoning one sends
        # its tools for one answer, after the student approves it.
        kind = "reason" if request.reasoning else "tool"
        tools = tuple(request.tools)

    return Routing(
        id=item["id"],
        question=item["question"],
        accepted=accepted_routes(item),
        expected_kind=expected.get("kind"),
        expected_tools=tuple(expected.get("tools", ())),
        expected_reasoning=expected.get("reasoning"),
        kind=kind,
        tools=tools,
        reasoning=detect_reasoning_kind(item["question"]),
    )


@pytest.fixture(scope="session")
def routings() -> dict[str, Routing]:
    """The whole set routed once, so every failing id is reported together."""
    return {item["id"]: route(item) for item in ITEMS}


def confusion(routings: dict[str, Routing]) -> str:
    """Expected next to got, per id, for every question the router gets wrong."""
    wrong = [routing for routing in routings.values() if routing.problem is not None]

    if not wrong:
        return "no mismatches"

    lines = [f"{len(wrong)} of {len(routings)} questions route wrongly:"]
    lines += [
        f"  {routing.id}  ({routing.question})  —  {routing.problem}"
        for routing in wrong
    ]

    return "\n".join(lines)


@pytest.mark.parametrize("item", ITEMS, ids=[item["id"] for item in ITEMS])
def test_every_question_routes_as_the_set_expects(item, routings):
    """The one assertion the set exists for: the router agrees with every item."""
    routing = routings[item["id"]]
    summary = confusion(routings)

    # Printed as well as asserted: a run that fails on three ids shows all three at once.
    print(summary)

    assert routing.problem is None, (
        f"{routing.id} ({routing.question}): {routing.problem}\n\n{summary}"
    )


# --- the set itself -------------------------------------------------------


def test_the_set_is_large_enough_to_be_worth_running():
    assert len(ITEMS) >= MIN_ITEMS

    regulation = sum("regulation" in accepted_routes(item) for item in ITEMS)

    assert regulation >= MIN_REGULATION_ITEMS


def test_every_id_is_unique_so_a_failure_names_one_question():
    ids = [item["id"] for item in ITEMS]

    assert len(ids) == len(set(ids))


def test_the_set_reaches_every_tool_in_the_catalogue():
    accepted = {route for item in ITEMS for route in accepted_routes(item)}
    tools = accepted & set(TOOLS)

    assert set(TOOLS) <= tools, f"never asked: {sorted(set(TOOLS) - tools)}"


def test_the_set_reaches_every_reasoning_kind():
    kinds = {
        route.removeprefix("reason:")
        for item in ITEMS
        for route in accepted_routes(item)
        if route.startswith("reason:")
    }

    assert kinds == set(REASONING_KINDS)


def test_every_accepted_route_is_one_the_router_can_answer():
    for item in ITEMS:
        for route in accepted_routes(item):
            known = route in set(TOOLS) or route == "regulation"

            assert known or route.startswith("reason:"), (
                f"{item['id']} accepts {route}, which the router cannot answer"
            )


# --- the ambiguous items ---------------------------------------------------


def test_at_most_one_item_in_twenty_accepts_several_routes():
    """The cap on `accept`: a set that accepts everything measures nothing."""
    ambiguous = [item for item in ITEMS if "accept" in item]

    assert len(ambiguous) <= MAX_AMBIGUOUS_SHARE * len(ITEMS)


def test_every_ambiguous_item_says_why_it_is_ambiguous():
    for item in ITEMS:
        if "accept" not in item:
            continue

        assert len(item["accept"]) > 1, f"{item['id']} accepts one route: use expected"
        assert "expected" not in item, f"{item['id']} has both expected and accept"
        assert item["ambiguous_reason"].strip(), (
            f"{item['id']} accepts several routes without saying why"
        )


# --- the held-out set -----------------------------------------------------
#
# eval/phase2_router_heldout.json is the check on the fallback classifier: questions
# written apart from the patterns. It is only a check while the regex still misses some of
# them, so widening a pattern until this set passes would retire the measurement.

HELDOUT_PATH = EVAL_PATH.with_name("phase2_router_heldout.json")


def load_heldout() -> list[dict]:
    return json.loads(HELDOUT_PATH.read_text(encoding="utf-8"))


HELDOUT = load_heldout()


def heldout_route(item: dict) -> str:
    """The route the regex alone takes for one held-out question."""
    request = detect_personal_request(item["question"])

    if request is None:
        return "regulation"

    kind = detect_reasoning_kind(item["question"])

    return f"reason:{kind}" if request.reasoning else request.tools[0]


def heldout_expected(item: dict) -> str:
    expected = item["expected"]

    if expected["kind"] == "regulation":
        return "regulation"
    if expected["kind"] == "reason":
        return f"reason:{expected['reasoning']}"

    return expected["tools"][0]


def test_the_held_out_set_is_never_added_to_the_patterns():
    """A regex that passed this set would no longer measure generalisation."""
    correct = sum(heldout_route(item) == heldout_expected(item) for item in HELDOUT)
    accuracy = correct / len(HELDOUT)

    assert accuracy < 0.95, (
        f"the regex now routes {accuracy:.0%} of the held-out set: either a pattern was "
        "widened to fit it, or the set has served its purpose and needs fresh questions"
    )


def test_the_held_out_set_is_the_size_the_classifier_was_specified_against():
    assert len(HELDOUT) == 33
    assert len({item["id"] for item in HELDOUT}) == 33


def test_the_held_out_set_reaches_every_tool_and_every_reasoning_kind():
    covered = {tool for item in HELDOUT for tool in item["expected"]["tools"]}
    kinds = {
        item["expected"]["reasoning"]
        for item in HELDOUT
        if item["expected"]["kind"] == "reason"
    }

    assert covered == set(TOOLS)
    assert kinds == set(REASONING_KINDS)


def test_the_held_out_set_keeps_the_regulation_questions_it_needs():
    """The trap this set guards: a rule question must never read the student's pages."""
    regulation = [item for item in HELDOUT if item["expected"]["kind"] == "regulation"]

    assert len(regulation) >= 8

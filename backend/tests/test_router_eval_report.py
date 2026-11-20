"""The eval runner's per-route table and its repeat handling, on sets small enough to count by hand.

`eval/run_router_eval.py` calls the real model, so it is not part of pytest. Its arithmetic is,
and it went wrong once without a test: after the `accept` change the table read 0/N for every route,
because the counter no longer added the items that routed correctly. These tests are that arithmetic.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = REPO_ROOT / "eval"

if str(EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_DIR))

import run_router_eval as runner  # noqa: E402


def row(route, accepted=None, runs=None, source="classifier"):
    """One in-memory row: one run unless `runs` names more, one accepted route unless given."""
    runs = (route,) if runs is None else runs
    accepted = (route,) if accepted is None else accepted

    return runner.Row(
        id=f"item-{route}-{'/'.join(runs)}",
        question=f"question for {route}",
        accepted=tuple(accepted),
        runs=tuple(runs),
        sources=tuple(source for _ in runs),
        latency_ms=1.0,
    )


def test_the_per_route_table_counts_the_items_that_routed_correctly():
    rows = (
        row("regulation"),
        row("get_gpa"),
        row("get_gpa"),
    )

    assert runner.per_route(rows) == {"regulation": (1, 1), "get_gpa": (2, 2)}


def test_a_route_that_was_never_taken_correctly_reads_zero():
    rows = (row("regulation"), row("get_gpa", runs=("get_grades",)))

    assert runner.per_route(rows) == {"regulation": (1, 1), "get_gpa": (0, 1)}


def test_the_table_counts_an_accepted_tool_route_as_correct():
    rows = (
        row("regulation", accepted=("regulation", "get_final_exams")),
        row("get_final_exams", runs=("regulation", "get_final_exams")),
    )
    table = runner.per_route(rows)

    assert table["regulation"] == (1, 1)
    assert table["get_final_exams"] == (0, 1)


def test_the_report_prints_the_table_it_computed():
    rows = (row("regulation"), row("get_gpa", runs=("get_grades",)))
    result = runner.SetResult(path=Path("phase2_router.json"), rows=rows)

    report = runner.report(result)

    assert f"{'regulation':<22} 1/1" in report
    assert f"{'get_gpa':<22} 0/1" in report


# --- repeat ----------------------------------------------------------------


def test_one_run_is_the_default_and_an_item_is_its_own_route():
    item = row("regulation")

    assert item.ok
    assert not item.varies
    assert not item.unstable
    assert item.status == "ok"
    assert item.seen == "regulation"


def test_two_runs_that_agree_on_an_accepted_route_are_correct():
    item = row(
        "get_final_exams",
        accepted=("regulation", "get_final_exams"),
        runs=("get_final_exams", "get_final_exams"),
    )

    assert not item.varies
    assert item.ok
    assert item.status == "ok"


def test_a_route_that_varies_inside_the_accepted_set_is_correct():
    """reg-04: the set says both answers are right, so which one a run picks is not a defect."""
    item = row(
        "regulation",
        accepted=("regulation", "get_final_exams"),
        runs=("regulation", "regulation", "get_final_exams"),
    )

    assert item.varies
    assert not item.unstable
    assert item.ok
    assert item.status == "VARIES (accepted)"
    assert item.seen == "regulation / regulation / get_final_exams"


def test_a_route_that_varies_outside_the_accepted_set_is_unstable_and_not_correct():
    item = row("regulation", runs=("regulation", "regulation", "get_final_exams"))

    assert item.varies
    assert item.unstable
    assert not item.ok
    assert item.status == "UNSTABLE"


def test_a_run_that_varies_inside_its_accepted_routes_meets_the_targets():
    rows = tuple(row("regulation") for _ in range(19)) + (
        row(
            "regulation",
            accepted=("regulation", "get_final_exams"),
            runs=("regulation", "regulation", "get_final_exams"),
        ),
    )
    result = runner.SetResult(path=Path("phase2_router.json"), rows=rows)

    assert result.correct == 20
    assert result.varies == 1
    assert result.unstable == 0
    assert result.meets_targets


def test_the_run_fails_on_one_unstable_item_even_at_full_accuracy():
    rows = tuple(row("regulation") for _ in range(19)) + (
        row("regulation", runs=("regulation", "get_gpa")),
    )
    result = runner.SetResult(path=Path("phase2_router.json"), rows=rows)

    assert result.accuracy == 0.95
    assert result.varies == 1
    assert result.unstable == 1
    assert not result.meets_targets


def test_the_report_names_a_varying_item_as_accepted_and_keeps_it_out_of_the_misses():
    rows = (
        row("regulation"),
        row(
            "regulation",
            accepted=("regulation", "get_final_exams"),
            runs=("regulation", "regulation", "get_final_exams"),
        ),
    )
    result = runner.SetResult(path=Path("phase2_router.json"), rows=rows)
    report = runner.report(result)

    assert "  varies: 1  (unstable: 0)" in report
    assert "VARIES (accepted)" in report
    assert "  misses: 0" in report
    assert "PASS" in report


def test_a_tool_route_the_item_refuses_is_an_unaccepted_tool_route():
    item = row("regulation", runs=("get_final_exams", "get_final_exams"))

    assert set(item.unaccepted_tool_routes) == {"get_final_exams"}
    assert item.sent_to_an_unaccepted_tool_route


def test_a_tool_route_the_item_accepts_is_only_reported():
    """An accepted tool route is reported, not a failure: it reads in the browser and sends nothing."""
    item = row(
        "regulation",
        accepted=("regulation", "get_final_exams"),
        runs=("get_final_exams",),
    )

    assert item.sent_to_a_tool_route
    assert item.unaccepted_tool_routes == ()
    assert not item.sent_to_an_unaccepted_tool_route


def test_a_reasoning_route_for_a_rule_question_is_the_hard_failure():
    item = row("regulation", runs=("reason:gpa_target",))

    assert item.sent_to_a_reasoning_route
    assert not item.sent_to_a_tool_route

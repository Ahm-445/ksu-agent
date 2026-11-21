"""The student's own values, as POST /chat/with-data receives them.

The shape of each tool's data is the extension's contract
(extension/src/contract.ts, from docs/api-contract.md): one entry per tool the `/chat`
reply named, and each entry carries exactly the fields the contract lists for it. The models
below are built from that catalogue, so a field the contract does not name — or a value of the
wrong type — is rejected here rather than reaching the prompt.

Nothing in this module keeps or logs a value: `validate_data` returns the models' own dicts for
one answer, and the caller logs tool names and sizes only.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, StrictFloat, StrictInt, StrictStr
from pydantic import ValidationError, create_model

# The contract's scalar types, spelled as in extension/src/contract.ts.
_SCALARS: dict[str, Any] = {
    "string": StrictStr,
    "number": StrictInt | StrictFloat,
    "string|null": StrictStr | None,
    "number|null": StrictInt | StrictFloat | None,
}

# One entry per tool: the field names the contract lists, and their types. An array is
# {"array": <scalar type or nested fields>}, exactly as in the extension's catalogue.
TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "get_gpa": {
        "cumulative_gpa": "string",
        "scale": "string",
        "earned_hours": "number",
        "registered_hours": "number",
        "as_of_term": "string",
    },
    "get_absences": {
        "courses": {
            "array": {
                "code": "string",
                "name": "string",
                "absence_percent": "number",
                "absences": "number",
                "lates": "number",
            }
        },
    },
    "get_final_exams": {
        "exams": {
            "array": {
                "code": "string",
                "name": "string",
                "day": "string|null",
                "date": "string|null",
                "time": "string",
                "location": "string|null",
            }
        },
    },
    "get_schedule": {
        "term": "string",
        "classes": {
            "array": {
                "code": "string",
                "name": "string",
                "activity": "string",
                "section": "string",
                "days": {"array": "number"},
                "start": "string",
                "end": "string",
            }
        },
    },
    "get_grades": {
        "term": "string",
        "courses": {
            "array": {
                "code": "string",
                "name": "string",
                "grade": "string|null",
            }
        },
    },
    "get_plan_progress": {
        "completed_hours": "number",
        "remaining_hours": "number",
        "remaining_courses": {
            "array": {
                "code": "string",
                "name": "string",
                "hours": "number",
                "group": "string",
                "type": "string",
                "level": "string",
            }
        },
    },
    "get_courses": {
        "courses": {
            "array": {
                "code": "string|null",
                "name": "string",
                "sections": {"array": "string"},
            }
        },
    },
    "get_assignments": {
        "items": {
            "array": {
                "title": "string",
                "course": "string",
                "due_at": "string",
            }
        },
    },
    "get_lms_grades": {
        "courses": {
            "array": {
                "code": "string|null",
                "name": "string",
                "items": {
                    "array": {
                        "title": "string",
                        "score": "number|null",
                        "possible": "number|null",
                        "status": "string",
                    }
                },
            }
        },
    },
}


class DataError(ValueError):
    """A body the contract does not allow: the 422 code, and nothing else."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _field_type(field: Any, name: str) -> Any:
    """The Python type for one catalogue field, building a model for a nested object."""
    if isinstance(field, str):
        return _SCALARS[field]

    items = field["array"]

    if isinstance(items, str):
        return list[_SCALARS[items]]

    return list[_build_model(items, name)]


def _build_model(fields: dict[str, Any], name: str) -> type[BaseModel]:
    """One object of the catalogue, with no field the contract does not name."""
    return create_model(
        name,
        __config__=ConfigDict(extra="forbid"),
        **{
            key: (_field_type(value, f"{name}{key.title()}"), ...)
            for key, value in fields.items()
        },
    )


TOOL_MODELS: dict[str, type[BaseModel]] = {
    tool: _build_model(fields, f"{tool.title().replace('_', '')}Data")
    for tool, fields in TOOL_SCHEMAS.items()
}


def data_size(data: dict[str, Any]) -> int:
    """The bytes the data occupies, for the log line that names sizes and never values."""
    return len(json.dumps(data, ensure_ascii=False).encode("utf-8"))


def validate_data(
    data: dict[str, Any], expected: Sequence[str] | None
) -> dict[str, Any]:
    """The data as the models hold it, or a DataError with the contract's 422 code.

    `expected` is what the `/chat` reply named. The keys must equal it: a key that was not
    named is `unknown_tool`, a named tool with no entry is `data_missing`, and a value the
    catalogue does not match is `data_invalid`.
    """
    if not data:
        raise DataError("data_missing")

    if expected is None:
        # The question was not a reasoning one, so no reply named a tool to send.
        raise DataError("unknown_tool")

    if any(tool not in TOOL_MODELS for tool in data):
        raise DataError("unknown_tool")

    if set(data) - set(expected):
        raise DataError("unknown_tool")

    if set(expected) - set(data):
        raise DataError("data_missing")

    validated: dict[str, Any] = {}

    for tool, payload in data.items():
        try:
            validated[tool] = TOOL_MODELS[tool].model_validate(payload).model_dump()
        except ValidationError as exc:
            raise DataError("data_invalid") from exc

    return validated

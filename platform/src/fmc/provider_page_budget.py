"""Source-only policy for Playtomic provider page checkpoints.

A booking page is an observation, NOT free-slot availability or provider write.
Bounded state travels in a durable leased job payload. No network in this file.
"""
from __future__ import annotations

from datetime import datetime
import re

_MAX_PAGE=48
_CURSOR=re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")


class PageBudgetError(ValueError):
    pass


def _utc(value):
    if not isinstance(value,str) or not value.endswith("Z"):
        raise PageBudgetError("Bounded UTC window required.")
    try:
        dt=datetime.fromisoformat(value.replace("Z","+00:00"))
        if dt.utcoffset().total_seconds()!=0:
            raise ValueError()
        return dt
    except (ValueError,AttributeError,TypeError) as exc:
        raise PageBudgetError("UTC window required.") from exc


def read_page_state(payload, start, end):
    if not isinstance(payload,dict):
        raise PageBudgetError("Invalid durable job payload.")
    if not _utc(start)<_utc(end):
        raise PageBudgetError("Invalid window ordering.")
    if "progress" not in payload:
        return {"page":0,"cursor":None,"window_start":start,"window_end":end}
    raw=payload["progress"]
    if not isinstance(raw,dict) or set(raw)!={"page","cursor","window_start","window_end"}:
        raise PageBudgetError("Unexpected checkpoint fields.")
    page=raw["page"];cursor=raw["cursor"]
    if type(page) is not int or not 0<=page<=_MAX_PAGE:
        raise PageBudgetError("Page ceiling exceeded.")
    if cursor is not None and (not isinstance(cursor,str) or not _CURSOR.fullmatch(cursor)):
        raise PageBudgetError("Invalid provider cursor.")
    if raw["window_start"]!=start or raw["window_end"]!=end:
        raise PageBudgetError("Replayed page window mismatch.")
    return dict(raw)


def next_page_state(previous, response):
    if not isinstance(previous,dict) or not isinstance(response,dict):
        raise PageBudgetError("Invalid page.")
    more=response.get("has_more")
    if type(more) is not bool or not isinstance(response.get("records"),list):
        raise PageBudgetError("Invalid provider page shape.")
    if not more:
        return None
    next_page=previous["page"]+1
    if next_page>_MAX_PAGE:
        raise PageBudgetError("Page limit reached.")
    cursor=response.get("next_cursor")
    if cursor is not None and (not isinstance(cursor,str) or not _CURSOR.fullmatch(cursor) or
                               cursor==previous.get("cursor")):
        raise PageBudgetError("Missing or repeating cursor.")
    return {"page":next_page,"cursor":cursor,
            "window_start":previous["window_start"],
            "window_end":previous["window_end"]}

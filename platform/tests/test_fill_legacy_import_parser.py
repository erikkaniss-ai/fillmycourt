"""Offline legacy CSV regression; stop before any DB context or persistence."""
import ast
import csv
import io
from pathlib import Path
from types import SimpleNamespace

import pytest

from fmc.common import DomainError
from fmc.operations import Operations


class ReachedDatabaseBoundary(Exception):
    pass


class DatabaseBomb:
    def __init__(self):
        self.calls = 0

    def tx(self):
        self.calls += 1
        raise ReachedDatabaseBoundary("Stopped before DB context, SQL or audit")


@pytest.fixture
def contact_csv():
    # Reuse the existing synthetic consent-proof fixture without invoking its
    # database/booking setup or constructing Operations.
    module = ast.parse(Path(__file__).with_name("test_platform.py").read_text(encoding="utf-8"))
    test = next(n for n in module.body if isinstance(n, ast.FunctionDef)
                and n.name == "test_contact_stage_commit_rollback")
    assignment = next(n for n in ast.walk(test) if isinstance(n, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "csv" for t in n.targets))
    return ast.literal_eval(assignment.value)


def stage_until_database(content, bomb):
    # Actual production method, unbound: no constructor, engine or network.
    Operations.stage_contacts(SimpleNamespace(db=bomb),
        {"venue_id": "fictional-venue", "id": "fictional-actor"}, "export", content)


def test_unterminated_consent_proof_is_redacted_422_before_database(contact_csv):
    header, row = contact_csv.strip().split("\n")
    prefix, proof = row.rsplit(",", 1)
    malformed = header + "\n" + prefix + ',"' + proof
    bomb = DatabaseBomb()
    with pytest.raises(DomainError) as exc:
        stage_until_database(malformed, bomb)
    assert (exc.value.code, exc.value.message, exc.value.status) == ("CSV", "Malformed CSV.", 422)
    assert proof not in str(exc.value)
    assert exc.value.__cause__ is None
    assert bomb.calls == 0


@pytest.mark.parametrize("variant", ["original", "bom", "quoted-comma", "escaped-quote", "multiline", "extra-header"])
def test_valid_csv_reaches_unchanged_staging_boundary(contact_csv, variant):
    if variant == "bom":
        contact_csv = "\ufeff" + contact_csv
    elif variant not in {"original", "bom"}:
        rows = list(csv.reader(io.StringIO(contact_csv)))
        if variant == "quoted-comma":
            rows[1][1] += ", Fictional"
        elif variant == "escaped-quote":
            rows[1][1] += ' "Fictional"'
        elif variant == "multiline":
            rows[1][-1] += "\nFictional second line"
        else:
            rows[0].append("legacy_extra")
            rows[1].append("ignored fictional value")
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        contact_csv = output.getvalue()
    bomb = DatabaseBomb()
    with pytest.raises(ReachedDatabaseBoundary):
        stage_until_database(contact_csv, bomb)
    assert bomb.calls == 1


@pytest.mark.parametrize("variant", ["missing-required", "duplicate-header"])
def test_existing_header_rejections_precede_database(contact_csv, variant):
    rows = list(csv.reader(io.StringIO(contact_csv)))
    if variant == "missing-required":
        rows = [r[1:] for r in rows]
    else:
        rows[0].append("name")
        rows[1].append(rows[1][1])
    output = io.StringIO()
    csv.writer(output).writerows(rows)
    bomb = DatabaseBomb()
    with pytest.raises(DomainError) as exc:
        stage_until_database(output.getvalue(), bomb)
    assert (exc.value.code, exc.value.status) == ("CSV_HEADERS", 422)
    assert bomb.calls == 0


def test_existing_byte_cap_is_preserved(contact_csv):
    # Fewer than two million characters, more than two million UTF-8 bytes.
    content = contact_csv + "🎾" * 500_000
    assert len(content) < 2_000_000 < len(content.encode())
    bomb = DatabaseBomb()
    with pytest.raises(DomainError) as exc:
        stage_until_database(content, bomb)
    assert (exc.value.code, exc.value.status) == ("IMPORT_LIMIT", 413)
    assert bomb.calls == 0


def test_existing_row_cap_is_preserved(contact_csv):
    header, row = contact_csv.strip().split("\n")
    bomb = DatabaseBomb()
    with pytest.raises(DomainError) as exc:
        stage_until_database(header + "\n" + (row + "\n") * 5_001, bomb)
    assert (exc.value.code, exc.value.status) == ("IMPORT_LIMIT", 413)
    assert bomb.calls == 0


def test_inherited_csv_field_limit_is_preserved_and_redacted(contact_csv):
    header, row = contact_csv.strip().split("\n")
    prefix, _ = row.rsplit(",", 1)
    limit = csv.field_size_limit()
    bomb = DatabaseBomb()
    with pytest.raises(DomainError) as exc:
        stage_until_database(header + "\n" + prefix + "," + "x" * (limit + 1), bomb)
    assert (exc.value.code, exc.value.message, exc.value.status) == ("CSV", "Malformed CSV.", 422)
    assert csv.field_size_limit() == limit
    assert bomb.calls == 0

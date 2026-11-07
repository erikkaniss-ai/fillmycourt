"""Pure parsing for the existing Operations people-import staging handler."""
import csv
import io

from .common import DomainError


def parse_people_csv(raw: str) -> tuple[list[dict], list[dict]]:
    """Return staged rows and semantic errors; reject structural faults in full.

    Error line numbers retain the existing logical-record enumeration. No
    database, authentication, source lookup, or import commit happens here.
    """
    if not isinstance(raw, str) or not 1 <= len(raw) <= 2_500_000:
        raise DomainError("CSV", "Malformed CSV.", 422)
    try:
        # The unchanged caller fingerprints the original text using UTF-8.
        raw.encode("utf-8")
    except UnicodeEncodeError:
        raise DomainError("CSV", "Malformed CSV.", 422) from None

    try:
        reader = csv.DictReader(io.StringIO(raw), strict=True)
        allowed = {"external_id", "name", "email", "phone", "marketing_consent"}
        headers = reader.fieldnames
        if (not headers or not set(headers).issubset(allowed)
                or len(headers) != len(set(headers))):
            raise DomainError("CSV_HEADERS", "Use external_id,name,email,phone,marketing_consent headers.", 422)
        staged, errors = [], []
        seen = set()
        for line, item in enumerate(reader, start=2):
            # DictReader represents extra cells as a list under None and
            # missing cells as None values. Neither is a valid declared row.
            if None in item or any(value is None for value in item.values()):
                raise DomainError("CSV", "Malformed CSV.", 422)
            row = {k: v.strip() for k, v in item.items()}
            if not any(row.values()):
                continue
            key = row.get("external_id") or row.get("email", "").lower() or row.get("phone")
            if not key:
                errors.append({"line": line, "error": "missing_identity"})
                continue
            if key in seen:
                errors.append({"line": line, "error": "duplicate_in_file"})
                continue
            seen.add(key)
            consent = row.get("marketing_consent", "").lower()
            if consent not in ("", "true", "false", "unknown"):
                errors.append({"line": line, "error": "invalid_marketing_consent"})
                continue
            row["marketing_consent"] = None if consent in ("", "unknown") else consent == "true"
            staged.append(row)
        return staged, errors
    except csv.Error:
        # Do not echo submitted values or the CSV library's diagnostics.
        raise DomainError("CSV", "Malformed CSV.", 422) from None

"""Explicit, server-side Auth Admin fixture lifecycle for Fill F1 staging UAT.

Not imported by the application or run automatically by pytest/CI. An authorised
runner supplies FILL_AUTH_ADMIN_GO=fictional-staging-only,
FILL_AUTH_ADMIN_PROJECT_REF=yclqnbcrchwieyzkyumx and FILL_AUTH_ADMIN_KEY through
its private environment, then uses ``with FixtureAuthAdmin.from_env() as run``.
``create(label)`` returns in-memory credentials for a NEW, initially banned user;
``activate(user_id)`` enables only that run's user. No memberships are granted.
The caller must separately verify fictional tenant membership and hosted UAT.
Never print credentials, enable HTTP debug logging, or put secrets in artifacts.

Uses supported POST /auth/v1/admin/users, GET/PUT /admin/users/{id}; no SQL,
signup, invitations, passwords for existing accounts, or account deletion.
https://github.com/supabase/auth/blob/master/openapi.yaml
https://supabase.com/docs/reference/javascript/auth-admin-createuser
https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid

Finally bans and reads back every known run-owned user, including on failure.
A process kill cannot run finally: the receipt's run ID identifies accounts for
administrator recovery. Ambiguous creates are NEVER retried or marked complete;
they requested an initial ban, but their actual outcome needs admin inspection.
Ban readback is not proof of immediate token revocation or hosted acceptance.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import os
import secrets
import uuid

import httpx

PROJECT = "yclqnbcrchwieyzkyumx"
ORIGIN = f"https://{PROJECT}.supabase.co"
GO = "fictional-staging-only"
LABELS = frozenset({"a-owner", "a-admin", "a-manager", "a-support",
                    "b-owner", "b-admin", "outsider"})
BAN = "876000h"


class FixtureAuthError(RuntimeError):
    """Only fixed error codes; never upstream bodies or credentials."""


@dataclass(frozen=True)
class FixtureCredentials:
    user_id: str
    email: str
    password: str = field(repr=False)


class FixtureAuthAdmin:
    def __init__(self, *, project_ref, go, key, transport=None):
        if project_ref != PROJECT or go != GO:
            raise FixtureAuthError("STAGING_FIXTURE_GO_REQUIRED")
        if not isinstance(key, str) or not key.strip():
            raise FixtureAuthError("AUTH_ADMIN_KEY_REQUIRED")
        self.run_id = uuid.uuid4().hex
        self._users = {}
        self._attempted = set()
        self._unknown_create = False
        self._closed = False
        self._disabled = set()
        self._http = httpx.Client(
            base_url=ORIGIN + "/auth/v1/", timeout=10, follow_redirects=False,
            trust_env=False, transport=transport,
            headers={"apikey": key, "Authorization": "Bearer " + key},
        )

    @classmethod
    def from_env(cls):
        return cls(project_ref=os.environ.get("FILL_AUTH_ADMIN_PROJECT_REF"),
                   go=os.environ.get("FILL_AUTH_ADMIN_GO"),
                   key=os.environ.get("FILL_AUTH_ADMIN_KEY"))

    def _request(self, method, path, body=None):
        try:
            response = self._http.request(method, path, json=body)
            if response.status_code not in (200, 201):
                raise FixtureAuthError("AUTH_ADMIN_REQUEST_FAILED")
            data = response.json()
            if not isinstance(data, dict):
                raise FixtureAuthError("AUTH_ADMIN_INVALID_RESPONSE")
            return data
        except (httpx.HTTPError, ValueError):
            raise FixtureAuthError("AUTH_ADMIN_OUTCOME_UNVERIFIED") from None

    def _open(self):
        if self._closed or self._unknown_create:
            raise FixtureAuthError("RUN_CLOSED_OR_NEEDS_RECONCILIATION")

    @staticmethod
    def _banned(data):
        try:
            until = datetime.fromisoformat(data["banned_until"].replace("Z", "+00:00"))
            return until > datetime.now(timezone.utc)
        except (KeyError, ValueError, TypeError, AttributeError):
            return False

    def _owned(self, user_id):
        # Only IDs returned by this run's create response can be read/changed.
        if user_id not in self._users:
            raise FixtureAuthError("FOREIGN_USER_DENIED")
        user = self._users[user_id]
        data = self._request("GET", "admin/users/" + user_id)
        metadata = data.get("app_metadata")
        if (data.get("id") != user_id or data.get("email") != user.email
                or not isinstance(metadata, dict)
                or metadata.get("fill_f1_run") != self.run_id
                or data.get("role") != "authenticated"):
            raise FixtureAuthError("FIXTURE_OWNERSHIP_UNVERIFIED")
        return data

    def create(self, label):
        self._open()
        if label not in LABELS or label in self._attempted:
            raise FixtureAuthError("FIXTURE_LABEL_DENIED")
        self._attempted.add(label)
        email = f"fill-f1-{self.run_id}-{label}@example.invalid"
        password = secrets.token_urlsafe(32) + "aA1!"
        # Persist no password. Initial ban limits damage from an ambiguous POST.
        try:
            data = self._request("POST", "admin/users", {
                "email": email, "password": password, "email_confirm": True,
                "ban_duration": BAN,
                "app_metadata": {"fill_f1_run": self.run_id, "fictional": True},
            })
            user_id = str(uuid.UUID(data["id"]))
            if user_id in self._users:
                raise ValueError("Duplicate identity")
        except (FixtureAuthError, KeyError, ValueError, TypeError, AttributeError):
            self._unknown_create = True
            raise FixtureAuthError("CREATE_OUTCOME_UNVERIFIED_NO_RETRY") from None
        # Track before readback, so failures still enter bounded cleanup.
        self._users[user_id] = FixtureCredentials(user_id, email, "")
        verified = self._owned(user_id)
        if not self._banned(verified) or not verified.get("email_confirmed_at"):
            raise FixtureAuthError("CREATED_FIXTURE_NOT_CONFIRMED_AND_BANNED")
        self._disabled.add(user_id)
        return FixtureCredentials(user_id, email, password)

    def activate(self, user_id):
        self._open()
        self._owned(user_id)
        self._disabled.discard(user_id)
        self._request("PUT", "admin/users/" + user_id, {"ban_duration": "none"})
        data = self._owned(user_id)
        if "banned_until" not in data:
            raise FixtureAuthError("FIXTURE_ACTIVATION_UNVERIFIED")
        if data["banned_until"] is not None:
            try:
                until = datetime.fromisoformat(data["banned_until"].replace("Z", "+00:00"))
                if until > datetime.now(timezone.utc):
                    raise ValueError("Still banned")
            except (ValueError, TypeError, AttributeError):
                raise FixtureAuthError("FIXTURE_ACTIVATION_UNVERIFIED") from None

    def receipt(self):
        return {"project_ref": PROJECT, "run_id": self.run_id,
                "mechanism": "supabase-auth-admin", "closed": self._closed,
                "unknown_create_outcome": self._unknown_create,
                "users": [{"id": uid, "disabled_verified": uid in self._disabled}
                          for uid in self._users],
                "hosted_uat": "NOT_RUN", "immediate_revoke": "NOT_VERIFIED"}

    def close(self):
        if self._closed:
            return
        failures = []
        for user_id in self._users:
            self._disabled.discard(user_id)
            try:
                self._owned(user_id)
                self._request("PUT", "admin/users/" + user_id, {"ban_duration": BAN})
                if not self._banned(self._owned(user_id)):
                    raise FixtureAuthError("BAN_NOT_VERIFIED")
                self._disabled.add(user_id)
            except FixtureAuthError:
                failures.append(user_id)
        self._http.close()
        self._closed = True
        if failures or self._unknown_create:
            raise FixtureAuthError("CLEANUP_UNVERIFIED_ADMIN_RECONCILIATION_REQUIRED")

    def __enter__(self):
        self._open()
        return self

    def __exit__(self, *_exc):
        self.close()

"""One worker-process token cache and conservative OAuth/data request pacing.

No provider credentials or access tokens persist to Postgres, GitHub, logs or
job payloads. An externally-approved single-process/stable worker is still
required to avoid repeated token acquisition across replica restarts.
"""
from __future__ import annotations

import hashlib
import hmac
import threading

from .common import DomainError
from .playtomic import Playtomic

_MAX_SESSIONS = 64


def _identity(organization_id, connection_id, client_id, secret, tenant):
    values=(organization_id,connection_id,client_id,secret,tenant)
    if any(not isinstance(v,str) or not v for v in values):
        raise DomainError("PROVIDER_CONFIG","Complete scoped club credentials required.",503)
    # Includes the secret only in an ephemeral one-way fingerprint. Never return
    # it or the client from any public status or database API.
    digest=hashlib.sha256()
    for item in values:
        payload=item.encode("utf-8")
        digest.update(len(payload).to_bytes(4,"big"))
        digest.update(payload)
    return digest.digest()


class ProviderTokenSessions:
    """Bounded, scoped cache used only by one long-lived provider worker."""

    def __init__(self, factory=Playtomic):
        self._factory=factory
        self._lock=threading.Lock()
        self._sessions={}

    def get(self, *, organization_id, connection_id, client_id, secret, tenant):
        fingerprint=_identity(organization_id,connection_id,client_id,secret,tenant)
        key=(organization_id,connection_id)
        with self._lock:
            old=self._sessions.get(key)
            if old is not None and hmac.compare_digest(old[0],fingerprint):
                return old[1]
            if len(self._sessions)>=_MAX_SESSIONS:
                self._sessions.clear()
            instance=self._factory(client_id,secret,tenant)
            self._sessions[key]=(fingerprint,instance)
            return instance

    def size(self):
        with self._lock:
            return len(self._sessions)

    def public_status(self):
        # No token, credential identifiers, tenant, or password-like content.
        return {"mode":"memory_only","sessions":self.size(),
                "persisted_tokens":0,"cross_process_vault":False}

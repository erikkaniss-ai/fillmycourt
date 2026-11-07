"""Offline V1Store.user setup/transaction contracts; no SQL or Auth is executed."""
from contextlib import contextmanager

import pytest

from fmc.supabase_v1 import V1Store


class Sentinel(Exception):
    pass


class RecordingEngine:
    def __init__(self, fail_stage=None):
        self.calls = []
        self.commits = self.rollbacks = 0
        self.error = None
        self.failure = Sentinel("fictional transaction failure")
        self.fail_stage = fail_stage

    @contextmanager
    def begin(self):
        try:
            yield self
        except BaseException as error:
            self.error = error
            self.rollbacks += 1
            raise
        else:
            self.commits += 1

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        self.calls.append((sql, params))
        stage = ("readonly" if sql.startswith("set transaction") else
                 "role" if sql.startswith("set local role") else "claims")
        if stage == self.fail_stage:
            raise self.failure


def store_for(engine):
    store = V1Store.__new__(V1Store)
    store.engine = engine
    return store


@pytest.mark.parametrize("readonly", [False, True])
def test_claims_share_one_bound_statement_after_role_and_readonly_setup(readonly):
    engine = RecordingEngine()
    # A deliberately non-UUID sentinel must remain a bound value, never SQL.
    uid = "fictional'; SELECT 'not executable"
    with store_for(engine).user(uid, readonly=readonly) as connection:
        assert connection is engine
        assert len(engine.calls) == (3 if readonly else 2)
        if readonly:
            assert engine.calls[0] == ("set transaction isolation level repeatable read, read only", None)
        assert engine.calls[-2] == ("set local role authenticated", None)
        claims = [(sql, params) for sql, params in engine.calls if "set_config(" in sql]
        assert len(claims) == 1
        sql, params = claims[0]
        assert sql.count("set_config(") == 2
        assert "request.jwt.claim.sub" in sql and "request.jwt.claim.role" in sql
        assert "'authenticated'" in sql and sql.count(", true)") == 2
        assert uid not in sql and params == {"uid": uid}
    assert (engine.commits, engine.rollbacks) == (1, 0)


@pytest.mark.parametrize("readonly", [False, True])
def test_body_exception_reaches_existing_transaction_exit_unchanged(readonly):
    engine = RecordingEngine()
    failure = Sentinel("fictional body failure")
    with pytest.raises(Sentinel) as caught:
        with store_for(engine).user("fictional-user", readonly=readonly):
            raise failure
    assert caught.value is engine.error is failure
    assert (engine.commits, engine.rollbacks) == (0, 1)


@pytest.mark.parametrize("stage", ["readonly", "role", "claims"])
def test_setup_failure_rolls_back_without_yield_or_retry(stage):
    engine = RecordingEngine(fail_stage=stage)
    yielded = False
    with pytest.raises(Sentinel) as caught:
        with store_for(engine).user("fictional-user", readonly=True):
            yielded = True
    assert not yielded
    assert caught.value is engine.error is engine.failure
    assert (engine.commits, engine.rollbacks) == (0, 1)
    assert len(engine.calls) == {"readonly": 1, "role": 2, "claims": 3}[stage]

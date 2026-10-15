from fmc.jobs import Queue
from fmc.playtomic import capabilities


def test_playtomic_adapter_is_not_a_write_adapter():
    assert capabilities() == {'read_sync': True, 'handoff': True, 'authorized_native_write': False}


def test_queue_claim_filters_do_not_mix_reconciliation_and_sync(env):
    queue = Queue(env.db, env.now)
    queue.enqueue(env.who['owner'], 'reconcile', 'reconcile-boundary-1', {'snapshot_id': 'source-1'})
    queue.enqueue(env.who['owner'], 'sync_players', 'sync-boundary-1', {'window_start': '2026-10-01T00:00:00Z', 'window_end': '2026-10-02T00:00:00Z'})
    assert queue.claim({'sync_players', 'sync_bookings', 'sync_payments'})['kind'] == 'sync_players'
    assert queue.claim({'reconcile'})['kind'] == 'reconcile'

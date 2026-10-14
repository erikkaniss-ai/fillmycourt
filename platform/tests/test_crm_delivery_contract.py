from fmc.crm_delivery import derive_delivery_state, deterministic_reply_intent, business_key


def test_monotonic_delivery_projection():
    assert derive_delivery_state(["READ", "CREATED", "DELIVERED"]) == "READ"
    assert derive_delivery_state(["BOOKING_CONFIRMED", "BOOKING_STARTED"]) == "converted"
    assert derive_delivery_state(["READ", "OPT_OUT", "CLICKED"]) == "suppressed"
    assert derive_delivery_state(["FAILED_PERMANENT"]) == "failed_permanent"
    assert derive_delivery_state(["CREATED", "SHADOW_SIMULATED"]) == "SHADOW_SIMULATED"


def test_optout_is_deterministic_and_other_replies_are_unclassified():
    assert deterministic_reply_intent("Please STOP messaging me") == "OPT_OUT"
    assert deterministic_reply_intent("Não me contacte") == "OPT_OUT"
    assert deterministic_reply_intent("I'd like to book") == "UNKNOWN"


def test_business_key_is_stable_and_audience_scoped():
    a = business_key("org", "action", "offer", "person1", "whatsapp")
    assert a == business_key("org", "action", "offer", "person1", "whatsapp")
    assert a != business_key("org", "action", "offer", "person2", "whatsapp")
    assert len(a) == 64

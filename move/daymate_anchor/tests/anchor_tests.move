#[test_only]
module daymate_anchor::anchor_tests;

use daymate_anchor::anchor::{Self, MemoryCommitted};
use std::unit_test::assert_eq;
use sui::event;

fun digest(fill: u8): vector<u8> {
    vector::tabulate!(32, |_| fill)
}

#[test]
fun emits_exactly_one_event_with_commitment_and_schema() {
    anchor::commit(digest(7), 1);
    assert_eq!(event::num_events(), 1);
    let events = event::events_by_type<MemoryCommitted>();
    assert_eq!(events.length(), 1);
    assert_eq!(anchor::commitment(&events[0]), digest(7));
    assert_eq!(anchor::schema_version(&events[0]), 1);
}

#[test]
fun emits_one_event_per_call() {
    anchor::commit(digest(1), 1);
    anchor::commit(digest(2), 2);
    let events = event::events_by_type<MemoryCommitted>();
    assert_eq!(events.length(), 2);
    assert_eq!(anchor::commitment(&events[1]), digest(2));
    assert_eq!(anchor::schema_version(&events[1]), 2);
}

#[test, expected_failure(abort_code = anchor::ECommitmentLength)]
fun rejects_short_commitment() {
    anchor::commit(vector::tabulate!(31, |_| 0u8), 1);
}

#[test, expected_failure(abort_code = anchor::ECommitmentLength)]
fun rejects_long_commitment() {
    anchor::commit(vector::tabulate!(33, |_| 0u8), 1);
}

#[test, expected_failure(abort_code = anchor::ECommitmentLength)]
fun rejects_empty_commitment() {
    anchor::commit(vector[], 1);
}

#[test, expected_failure(abort_code = anchor::EInvalidSchemaVersion)]
fun rejects_schema_version_zero() {
    anchor::commit(digest(9), 0);
}

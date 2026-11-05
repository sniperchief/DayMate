/// DayMate memory anchoring.
///
/// Emits one privacy-safe event per anchored memory version. The event
/// carries ONLY a 32-byte salted SHA-256 commitment and the commitment
/// format version; no memory text, names, IDs or Walrus blob IDs ever reach
/// the chain. The package stores no objects and has no admin, token or
/// payment functionality.
module daymate_anchor::anchor;

use sui::event;

/// The commitment is not exactly 32 bytes (a SHA-256 digest).
const ECommitmentLength: u64 = 0;
/// Schema version 0 is reserved and never valid.
const EInvalidSchemaVersion: u64 = 1;

const COMMITMENT_LENGTH: u64 = 32;

/// Emitted once per anchored memory version.
public struct MemoryCommitted has copy, drop {
    commitment: vector<u8>,
    schema_version: u16,
}

/// Emit a `MemoryCommitted` event. Anyone can call this; off-chain
/// verification therefore also checks the transaction sender.
public fun commit(commitment: vector<u8>, schema_version: u16) {
    assert!(commitment.length() == COMMITMENT_LENGTH, ECommitmentLength);
    assert!(schema_version > 0, EInvalidSchemaVersion);
    event::emit(MemoryCommitted { commitment, schema_version });
}

#[test_only]
public fun commitment(e: &MemoryCommitted): vector<u8> { e.commitment }

#[test_only]
public fun schema_version(e: &MemoryCommitted): u16 { e.schema_version }

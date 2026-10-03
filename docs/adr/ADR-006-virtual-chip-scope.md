# ADR-006: Virtual-chip-only scope and the real-money compliance boundary

Status: Accepted
Date: 2026-10-03

## Decision

The product is a social poker platform. Virtual chips have no monetary
value. The codebase must not contain fiat/crypto deposits or withdrawals,
real-money wallets, peer-to-peer cash transfers, external settlement of
poker results, or any mechanism that converts chips into money or goods.
Chips enter circulation only through club treasury grants and leave it only
through club deductions, both audited.

## Consequences

- Ledger account kinds and transaction kinds intentionally have no
  cash/payment variants. Adding any would require a separate, regulated
  workstream with jurisdiction-specific legal review (KYC/AML, licensing,
  geofencing) and a superseding ADR.
- UI copy states that chips have no monetary value.

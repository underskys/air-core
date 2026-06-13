# Network Scanner Host Capability RFC

Status: proposed
Target layer: host ABI / host implementation / policy

Formal ledger decisions:
[Network Scanner Host ABI](../../requests/rejected/network-scanner-host-abi.md)
and [lan-observer-style Readonly Consumer Proof](../../requests/accepted/lan-observer-readonly-proof.md).

## Source Demo/Project

AIR v0.11 Network Health Dashboard and future AI-generated internal
network tooling.

## Problem

AI-generated network diagnostics need safe execution. AIR can be useful for
orchestrating checks, scoring normalized facts, selecting next diagnostic
steps, and driving UI/status output, but real network scanning or probing is
security-sensitive host authority.

Without a documented host-controlled model, future demos could pressure AIR
Core or stdlib toward unsafe network access, raw sockets, hidden probing, or
product-specific scanner behavior.

## Current Workaround

v0.11 uses mock/static data in `examples/network_dashboard`. Existing
`spec/NETWORK_ABI.md` supports deterministic network reasoning over host
provided facts, but AIR does not perform real scanning, DNS execution, socket
access, interface inspection, or OS-level probing.

## Proposed Generic API

Future scanner/logging capability should be a policy-gated host ABI. AIR should
orchestrate and analyze; the host should perform probes and return scalar
request handles, result codes, and normalized facts.

Possible future imports:

- `net.probe_tcp(target: i32, port: i32, timeout_ms: i32) -> i32`
- `net.resolve_dns(name_id: i32, record_type: i32, timeout_ms: i32) -> i32`
- `net.ping_host(target: i32, timeout_ms: i32) -> i32`, only where the host
  supports it without unsafe privilege escalation
- `net.read_scan_result(request: i32, out: ptr, len: i32) -> i32`
- `log.emit(id: i32, severity: i32, value: i32) -> void` or existing
  `debug.metric(id: i32, value: i32) -> void`

Names and signatures are design candidates only. They are not v0.11 public ABI.
Any accepted API must be reconciled with `AGENTS.md`,
`spec/AIR_LAYER_MANIFEST.md`, `spec/NETWORK_ABI.md`, capability specs,
verifier/audit coverage, tests, and migration notes.

## Why Generic

Safe TCP reachability checks, DNS resolution facts, latency/timeout summaries,
probe result records, audit logs, and rate-limited host policy are broadly
useful for internal tools, validators, deployment checks, diagnostics, and
DevOps dashboards.

## Why Not Project-Specific

The security model is not specific to one dashboard. Every product that lets AI
generate network tools needs the same boundary:

- AIR code emits bounded scalar requests and analyzes returned facts.
- The host owns sockets, DNS clients, subprocesses, interfaces, privileges,
  target validation, timeouts, and logs.
- Policy decides what is allowed before the host sends traffic.

## Non-Goals

- No raw sockets in AIR.
- No unrestricted scanning.
- No root-only operations as a portable AIR promise.
- No hidden network access.
- No OS interface inspection in AIR.
- No packet capture or pcap parsing in AIR.
- No background scanning outside explicit host policy.
- No v0.11 runtime implementation.

## Policy Model

Default policy is deny.

A host implementation must require explicit grants before any probe runs:

- allowed CIDRs, host IDs, or named internal target groups;
- allowed ports and protocols;
- maximum probes per time window;
- maximum concurrency;
- timeout limits;
- maximum result size;
- local-network-only or internal-network-only restrictions by default;
- explicit opt-in before any external network target is allowed.

The policy must be host-owned and reviewable outside AIR source. AIR modules
must not be able to widen their own target set, port set, rate limits, timeout
limits, or network scope.

## Audit And Diagnostics

The host must record an audit log for every attempted probe:

- module/package identity;
- requested target and port after policy normalization;
- capability and policy grant used;
- start/end time or timeout bucket;
- result code;
- denied reason, if blocked;
- rate-limit or timeout events;
- host adapter identity.

Denied probes should be explicit diagnostics, not silent no-ops. Unsupported
host features such as ICMP ping should be reported clearly.

## Compatibility Risk

High if promoted directly into public ABI without policy. Network probing can
produce traffic, security alerts, privacy issues, and accidental external
access. Any future ABI must be capability-gated, deny-by-default, audited, and
tested against unsupported/denied paths.

Low for v0.11 because this request is documentation only and the Network Health
Dashboard remains mock-data based.

## v0.11 Decision

documentation/RFC only

v0.11 must not implement scanner runtime behavior. The initial Network Health
Dashboard uses mock/static data and `capabilities { ui, debug }` only. It does
not request `net`, `fs`, `io`, raw sockets, OS scanning, or host probes.

## Future Target

v0.12/v0.13 host implementation candidate.

Before implementation, this RFC needs:

- accepted host ABI design with exact signatures;
- policy schema or host policy contract;
- verifier/audit expectations for scanner imports;
- conformance cases for allowed, denied, missing capability, unsupported host
  feature, timeout, rate limit, and result-read flows;
- documentation showing how scanner hosts differ from deterministic network
  reasoning modules.

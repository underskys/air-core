# AIR Network Reasoning ABI v0.10

AIR network modules are deterministic reasoning plugins. They do not own real
network authority.

## Boundary

Hosts own:

- sockets, raw packet capture, pcap/tcpdump/nmap/dig/traceroute execution;
- DNS resolution, HTTP clients and servers, SSH tunnels, OS routing tables;
- interface discovery, privilege prompts, packet bytes, and subprocesses;
- localized diagnostic messages and product UI.

AIR owns:

- deterministic classification from normalized scalar facts;
- IPv4/CIDR arithmetic over `i32` inputs;
- bounded scan planning, progress, ETA buckets, and degradation codes;
- DNS/access/route verdict scoring from host-provided facts;
- packet/flow suspicion scoring from decoded packet facts;
- retry/backoff state machines when all loop bounds are explicit.

The host may expose product-specific network imports, but those imports are
host ABIs, not AIR Core semantics. They must be capability-gated and documented
by the embedding product.

## Source Names

`net.*` is reserved for host imports such as `net.http_get`.

Generic bitflag logic lives in source stdlib as `use std.packet`, which exposes
`packet.has_flag(value, mask)`.

Protocol-specific TCP aliases such as `has_syn`, `has_ack`, `has_rst`,
`has_fin`, and `has_psh` are example or reusable-network-kit material. They are
not public stdlib because stdlib must remain domain-neutral and
protocol-neutral.

## Packet Fact Records

Hosts decode packets. AIR should not parse raw packet bytes in v0.10. A host can
pass scalar facts directly or provide a bounded `buffer<i32,N>` record.

Canonical packed packet fact layout v0.10:

| Index | Field | Meaning |
| --- | --- | --- |
| 0 | `proto` | IP protocol number, for example `6` for TCP |
| 1 | `direction` | host-defined direction code |
| 2 | `flags` | decoded protocol flags, TCP flags when `proto == 6` |
| 3 | `payload_len` | payload byte count |
| 4 | `src_port` | source port, or `0` when unavailable |
| 5 | `dst_port` | destination port, or `0` when unavailable |
| 6 | `age_ms` | age of the observation |
| 7 | `retrans_count` | host-estimated retransmission count |
| 8 | `dns_req_count` | DNS requests seen for the flow |
| 9 | `dns_resp_count` | DNS responses seen for the flow |
| 10 | `status` | host status: `0` ok, negative values are host errors |

AIR modules must check that a host-provided record has enough fields before
reading it. Buffer indexes are element indexes, not byte offsets.

## Diagnostic Codes

AIR returns stable numeric codes. Hosts map those codes to user-facing strings,
localized text, logs, and UI severity.

Recommended code bands:

- `0`: OK / no issue.
- `1..19`: informational or low-confidence degradation.
- `20..49`: degraded network behavior or incomplete evidence.
- `50..79`: host/tool/runtime failure.
- `80..99`: protocol-level failure, reset, timeout, or data loss suspicion.
- negative values: invalid input or unsupported record shape.

Example modules may define narrower local codes, but they must document those
codes in comments, specs, or host mapping tables before product use.

## Scan Planning

AIR scan planners consume facts such as total hosts, checked hosts, phase,
available host tools, elapsed time buckets, and user stop/fail status. AIR may
return:

- phase code;
- chunk size;
- progress percentage or bucket;
- ETA bucket;
- degradation reason code.

AIR must not execute scans, open sockets, invoke `nmap`, or inspect OS network
interfaces directly.

## DNS And Route Verdicts

DNS modules consume resolver counts, direct-resolution success, NXDOMAIN and
timeout counters, and host status codes.

Route modules consume gateway/default-route facts, VPN state, first-hop status,
MTU facts, and host status codes.

AIR verdicts should be scalar and deterministic. Hosts decide which next probe
to run and how to explain the result.

## Async Host Operations

Long-running host operations should use request handles and canonical bounded
polling:

```air
%status:i32 = io.poll_bounded %request, 4
%len:i32 = @io.result_len(%request)
```

`io.poll_bounded` traps unless the final status is ready. On trap or instance
teardown, the host must cancel or invalidate outstanding request handles and
must not write into that instance's linear memory. Pending output buffers must
not be reused unless the previous request has completed or has been cancelled.

Manual non-trapping polling can use `loop.poll` plus explicit status branches,
but `io.result_len` must be called only after readiness is proven.

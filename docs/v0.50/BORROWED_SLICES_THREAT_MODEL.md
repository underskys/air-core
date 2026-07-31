# Borrowed Slices Threat Model

Status: Accepted for v0.50 implementation

## Scope

This threat model covers synchronous borrowed-slice invocation in the
`wasm-linear` memory domain defined by
[Borrowed Slices v0.50](../rfcs/BORROWED_SLICES_v0_50.md).

It covers Core parsing and verification, package admission, Wasm entry
preflight, host adapter behavior, evidence, and resource certificates.

## Assets

- Wasm linear memory outside each borrowed range.
- Host-owned input and output bytes.
- AIR-owned region memory.
- Persistent state supplied as an explicit mutable borrow.
- Package, module, interface, verifier, and certificate identity.
- Deterministic diagnostics and evidence.
- Access permissions and invocation lifetime.

## Trust Boundaries

1. Source to parser/verifier.
2. Verified module to lowerer and package builder.
3. Package to host adapter.
4. Host object/view to selected Wasm instance memory.
5. Entry preflight to user AIR instructions.
6. Invocation result to evidence and caller.

The host is responsible for truthful grants, source provenance, and transfer
declarations. AIR independently validates what it can observe: package
identity, instance memory, range, alignment, permissions, overlap, contracts,
and deterministic result metadata.

## Threat Actors

### Malicious or malformed AIR source

Attempts to escape, free, retain, overrun, write through readonly memory, read
from writeonly memory, or launder a borrow through another type.

### Buggy host adapter

Passes a wrong length, wrong instance, stale view, wrong access mode,
overlapping mutable ranges, or incomplete evidence.

### Malicious host

Lies about byte origin or transfer mode, reuses buffers concurrently, changes
memory during invocation, or substitutes package/interface identity.

AIR cannot make a malicious host truthful. It can fail closed on observable
inconsistency and classify host statements as declarations.

### Direct Wasm caller

Bypasses the high-level SDK and invokes the raw export with crafted
pointer/length pairs.

The generated Wasm entry preflight is therefore mandatory; SDK checks alone
are insufficient.

### Stale or substituted artifact

Combines code, manifest, interface metadata, evidence, or certificate from
different package identities.

## Security Invariants

For each accepted borrow:

```text
0 <= actual_length <= declared_maximum
declared_minimum <= actual_length
ptr <= memory_size
actual_length <= memory_size - ptr
ptr % alignment == 0
```

For each access:

```text
0 <= offset
access_width <= actual_length - offset
```

The subtraction form is used only after non-negative checks and avoids
addition overflow.

The implementation also enforces:

- mode-appropriate load/store behavior;
- no return, storage, retention, free, or unrestricted pointer conversion;
- one synchronous invocation lifetime;
- no mutable overlap;
- no memory growth or backing replacement while active;
- deterministic checked-entry contracts;
- exact package/interface/evidence binding.

## Threats and Mitigations

| Threat | Mitigation | Residual |
| --- | --- | --- |
| pointer plus length overflow | subtraction-form entry check | engine defects out of scope |
| offset plus width overflow | Task 02 region-style checked helper | implementation must cover every opcode |
| wrong actual length | ABI pair plus range/refinement preflight | malicious host can withhold intended bytes |
| write through readonly | verifier mode rule and direct tests | host may mutate backing bytes externally |
| read from writeonly | verifier mode rule | host observes its own backing memory |
| mutable aliasing | pairwise fail-closed overlap check | readonly external mutation remains host risk |
| use after invocation | noescape verifier plus adapter epoch | engine/runtime defects out of scope |
| return or storage escape | AST/type-flow rejection | unsupported hidden channel claims |
| free host memory | reject ownership operations on borrowed type | host controls external lifetime |
| memory growth/view detachment | capture memory identity; prohibit growth; readback check | engine-internal copy unobservable |
| reentrant invocation | per-instance active-borrow fence | multiple instances remain host-managed |
| cross-thread race | shared memory and cross-thread borrow unsupported | host can violate process policy outside AIR |
| direct raw Wasm call | generated entry preflight | external mutation during call is a host violation |
| package substitution | package and interface digests | compromised hash primitive out of scope |
| stale certificate | module/package/verifier/interface binding | host enforcement is separate |
| transfer-mode lie | required declaration and evidence classification | AIR cannot prove pre-adapter copies |
| cross-value underallocation | checked-entry multiplication and length comparison | only bounded grammar is supported |
| arithmetic overflow in relation | divide-before-multiply guard | unsupported expressions fail closed |
| hidden mutable state | conformance profile rejects reachable hidden state | general non-conformance modules retain existing globals |
| diagnostic leakage | stable bounded metadata; omit raw bytes/pointers | file/function names remain visible |

## Host Mutation and TOCTOU

For `copied_into_wasm` mode, AIR executes against its private checked range.
Host mutation of the source after copy does not affect that invocation.

For `wasm_memory_view`, a host with access to the same instance memory can
mutate bytes during execution. v0.50 treats this as a host contract violation
and does not claim data-race protection. The adapter:

- rejects shared Wasm memory;
- rejects concurrent/reentrant mutable invocation;
- binds the backing memory identity;
- may hash readable input before execution and mutable output after execution;
- records transfer mode.

Cryptographic hashing does not prevent mid-call mutation. A stronger trusted
host or engine isolation profile is a future concern.

## Hostile Cases

Implementations MUST test at least:

1. `ptr` near `2^32` with a length that would wrap.
2. actual length above the declared maximum.
3. actual length below a non-zero minimum.
4. misaligned pointer.
5. one-byte access past actual length but inside Wasm memory.
6. readonly store.
7. writeonly load.
8. returning or storing a borrow.
9. freeing a borrow.
10. overlapping mutable parameters.
11. readonly/readonly overlap.
12. zero-length boundary at memory end.
13. failed `frames * multiplier` relation.
14. relation multiplication overflow.
15. direct raw Wasm invocation with crafted pairs.
16. memory growth/backing replacement.
17. reentrant invocation.
18. wrong package/interface/certificate tuple.
19. missing transfer disclosure.
20. attempted conversion to plain `slice` or `ptr`.

## Evidence Privacy

Portable evidence contains lengths, modes, domains, digests, checks, and
outcomes. It SHOULD NOT contain:

- raw borrowed bytes;
- credentials;
- arbitrary host objects;
- reusable native pointers;
- stable process addresses.

Content digests may still reveal equality across invocations. A deployment may
salt or suppress optional content digests under an accepted evidence policy,
but identity and bounds evidence remain mandatory.

## Unsupported Security Claims

This design does not prove:

- universal zero-copy;
- realtime deadlines;
- constant time;
- absence of timing or cache channels;
- absence of termination channels;
- confidentiality from a malicious host;
- safety of arbitrary native pointers;
- safety across asynchronous or cross-thread use;
- shared mutable concurrency;
- correctness of external host code;
- engine or compiler freedom from defects.

## Kill Criteria

Stop implementation and request architecture revision if:

- any accepted target cannot preserve actual byte length through its boundary;
- exported entry preflight can be bypassed by a supported invocation path;
- borrowed values can reach existing storage or return paths without a
  verifier proof;
- mutable overlap cannot be checked before execution;
- AIR ABI 0.10 behavior would need reinterpretation;
- Host ABI mutation becomes necessary;
- current lowering cannot distinguish borrowed and owned/internal slices;
- evidence cannot bind the exact interface descriptor;
- a supported operation lacks a complete width/bounds mapping;
- a host profile requires asynchronous, shared-memory, or arbitrary-pointer
  semantics.

## Rollback

Reject AIR ABI 0.11 packages that declare borrowed slices. Keep AIR ABI 0.10,
internal slices, Task 01 fail-closed exported-slice behavior, and Task 02
region bounds intact.

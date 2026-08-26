# AIRSwift

`AIRSwift` is the standalone Swift conformance host for frozen AIR v0.51
typed values, Host Contract records, and candidate typed-interface identities.
It is product-neutral: consumer type schemas and host adapters are injected by
the embedding application.

The AIR specification and pinned Node reference implementation remain the
semantic authority. This package reproduces canonical bytes and digest domains;
it does not define a second language, policy, wire format, or capability source.

The runtime layer accepts host-provided immutable artifact bytes and contains
only generic verification/session boundaries. It has no filesystem, network,
provider, UI, or ambient capability authority.

Run portable tests and the conformance executable from this directory:

```sh
swift test
swift run AIRSwiftConformance
```

The conformance executable emits literal frozen-vector parity results and
machine-readable holds for frozen vectors that still lack an exact fixture.

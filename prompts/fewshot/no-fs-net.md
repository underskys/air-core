# Few-shot: No Hidden Filesystem Or Network Authority

Bad request:

> Read a local config file and call an HTTP endpoint from AIR.

Reject this in AIR Core unless an accepted Host ABI and capability exist.

Bad AIR shape:

```air
module bad
capabilities { }

extern fs.read(path: i32) -> i32
extern net.http_get(url: i32) -> i32
```

Why it is invalid:

- Host imports are invented or unsupported.
- Capabilities are missing.
- AIR must not expose file handles, sockets, URLs, subprocesses, or host objects
  without accepted Host ABI/profile support.

Allowed repair:

- Keep AIR logic deterministic and scalar.
- Put host resource access behind a future RFC-backed Host ABI, profile, and
  manifest contract.
- For current packages, pass verified scalar inputs into AIR and return verified
  scalar decisions.

Example deterministic replacement:

```air
module policy
capabilities { }

export func allow_retry(status_code: i32) -> i32 {
entry:
  %too_many:bool = eq %status_code, 429
  %retry:i32 = select %too_many, 1, 0
  return %retry
}
```

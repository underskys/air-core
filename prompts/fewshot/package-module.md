# Few-shot: Package-local Module

Goal: split pure helper logic into a package-local module.

`air.package.json`:

```json
{
  "name": "small-policy-package",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "main.air",
  "capabilities": [],
  "targetProfiles": ["cli"]
}
```

`main.air`:

```air
module main
use "./score.air" as score
capabilities { }

export func run(value: i32) -> i32 {
entry:
  %out:i32 = @score.clamp_score(%value)
  return %out
}
```

`score.air`:

```air
module score
const MAX_SCORE:i32 = 100
capabilities { }

export func clamp_score(value: i32) -> i32 {
entry:
  %over:bool = gt_s %value, MAX_SCORE
  %out:i32 = select %over, MAX_SCORE, %value
  return %out
}
```

Check:

```sh
node bin/airc.js package-check small-policy-package --profile cli --source-only --json
```

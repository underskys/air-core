---
name: air
description: Write, fix and check AIR (.air) source in the typed-v0.53 profile with the airc verifier from @underskys/air-core. Use when asked for AIR code, an .air file, an AIR rule or policy, or to fix an airc refusal or an air.* error code; also when porting legacy AIR to typed-v0.53. Not for Adobe AIR.
---

# AIR (typed-v0.53)

1. Before writing AIR, read the AIR for models page once in the session.
   Use the first path that exists:
   - `node_modules/@underskys/air-core/docs/v0.53/AIR_FOR_MODELS.md` (project install)
   - `"$(npm root -g)/@underskys/air-core/docs/v0.53/AIR_FOR_MODELS.md"` (global install)
   - `docs/v0.53/AIR_FOR_MODELS.md` (inside the air-core repository)
   Its examples are in `docs/v0.53/for-models/examples/` beside it.

2. Write the typed-v0.53 profile only: `module` first, typed locals
   (`%x: T = ...`), each name bound once, value `if` and `match` whose blocks
   end in `yield`, `loop.fold` as the only loop, `checked_` or `wrapping_`
   i32 arithmetic, one operation per statement, one final `return`.

3. Check every file before you show it or hand it over:

   ```sh
   airc check FILE --source-profile typed-v0.53 --allow-candidate-profile --lsp-json
   ```

   Use an airc that is already installed: `node_modules/.bin/airc` in a project
   that has `@underskys/air-core` installed, `airc` from a global install, or
   `node bin/airc.js` inside the air-core repository. If none of them exists,
   stop: tell the user the code is unchecked and ask them to install
   `@underskys/air-core`. Never fetch or run a tool by a package name through a
   package runner: it can install and run a different package.

   For a module that will be built, also run
   `airc build FILE --source-profile typed-v0.53 --allow-candidate-profile --emit wasm -o OUT.wasm`
   with OUT in a scratch folder; `check` does not run the build limits.

4. On a refusal, read `code`, `line` and `repairHint` from the JSON, find
   the code in section 6 of the page, apply the fix and check again. After
   three failed rounds, stop and report the last code and line.

5. Never invent a host import. An `extern` must be a Host ABI registry
   entry with its exact types, its family in `capabilities { ... }` and its
   key in `demand { ... }`.

6. A pass means the source verifies under typed-v0.53. It is not permission
   to run anything; the host decides that.

7. For a legacy-v0.50 file, try `airc migrate FILE` first, then check its
   output as in step 3.

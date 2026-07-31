# Canonical Format Fixture

This fixture covers the v0.47 first canonical formatter slice.

It is intentionally source-only:

- `input.air` uses supported readable AIR syntax with comments and noncanonical
  instruction spellings.
- `expected.air` records deterministic canonical formatter output.

The fixture covers:

- module declaration;
- extern import and exported function;
- capabilities and effects;
- tablegroup syntax;
- `f32.sqrt`, `f32.sin`, and `f32.cos`;
- bounded `output.emit` call syntax.

The test checks:

- `airc format --canonical input.air` matches `expected.air`;
- legacy `airc fmt input.air` remains equivalent;
- formatted output parses;
- formatting is idempotent.

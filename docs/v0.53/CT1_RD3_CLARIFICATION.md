# CT-1: Narrow RD-3 Clarification and F1 Correction

```text
STATUS=HUMAN_AUTHORIZED_NARROW_CLARIFICATION
AUTHORITY_SOURCE=human_user_direct
DECISION_DATE=2026-10-14
RD_3=2
SCOPE=P0-02 expression cost accounting only
ABI_CHANGED=false
HOST_ABI_CHANGED=false
```

This addendum records the owner's explicit decision after the independent P0-02
review returned REQUEST_CHANGES on dev `d4e8843aee9725e3a1aaa5b4f1dfd9634a12ca06`
and public `94b05f33047ae57d353e3cd5e4ddf8ecaad8d353`. It clarifies the interaction
of the constructor, scalar-operation, match-arm and return rows in RFC R3.1
section 6.4. The historical RFC, its vector IDs and the H53 record are not edited.

## Required Accounting

- A numeric operation used directly as a return operand contributes its existing
  CT-1 scalar row, followed by the return row: 1 + 1 = 2 steps.
- A numeric operation used as a match-arm expression contributes its scalar row
  inside that arm's summary and the componentwise max over arms.
- An option/result constructor outside a match arm contributes one constructor
  row. A constructor used directly in return therefore costs 1 + 1 = 2 steps.
- A constructor-initialized local contributes one constructor row, not an extra
  assignment row. Returning that local adds the return row: also 2 steps.
- Literal, enum-constant and reference operands add no evaluation row. A bare
  literal/reference return still costs one return step.
- An atom match arm, including a constructor atom, still costs zero steps. The
  RD-3 clarification does not remove that explicit CT-1 exemption.
- Applicable refinement checks remain additive. An operation returned into a
  refined result costs 1 operation + 1 return + 1 check = 3 steps; a reference
  already of the identical refined type adds no check.

Examples with independently derived expectations:

```text
return i64.checked_add %x, %y                    => steps 2
%o: i64 = i64.checked_add %x, %y; return %o        => steps 2
return option.some<i32> %a                       => steps 2
%o: option<i32> = option.some<i32> %a; return %o   => steps 2
return %a                                       => steps 1
```

This is not a grammar expansion. Existing verified typed-v0.51 expression
shapes are summarised; parser, verifier, formatter, lowering, runtime result and
authority semantics remain unchanged. In particular, operation-valued match
arms still have the existing lowering limitation and are not newly executable.

## Identity and Review

The cost-table ID remains `air.workbound.cost/1`, with revision `P0-02-F1-RD3`.
Its existing row weights and digest domain remain unchanged. The revised row
application text and revision change the content digest, while the source edit
changes the compiler implementation digest. Summary records under old and new
keys must not be treated as interchangeable.

The implementation and its added correction tests are candidates for fresh
independent QA. This decision does not accept the corrected P0-02 candidate,
activate SCALAR, revise an ABI, or authorize merge, tag, publish or deploy.

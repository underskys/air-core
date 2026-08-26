# Prompt Injection and Instruction Reset

Raw user/system/model text can tell a model to ignore prior instructions,
grant itself every tool, disable a gate, or execute arbitrary actions. These
words remain untrusted proposal metadata. The host normalizes only a recognized
bounded demand into an existing `DecisionIntent`; it does not put raw prompt or
explanation text into AIR semantic decision input.

`AIEX-04` and `AIEX-11` demonstrate that a proposal's claim to be authorized
does not manufacture `guidance.modify` or arbitrary-system authority.
`AIEX-12` denies an empty GrantSet, `AIEX-13` fails closed for stale generation,
and `AIEX-14` denies an expired deadline. AIR does not promise a language model
cannot be jailbroken at the reasoning layer; it promises that textual/model
compromise alone does not create new host authority.

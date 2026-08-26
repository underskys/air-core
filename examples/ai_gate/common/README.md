# Common Host Normalization

The common code constructs only existing canonical `DecisionIntentV1`,
`GrantSetV1`, and `CanonicalTypedInputV1` records. It validates them through
the frozen Node reference implementation and calls its
`deriveEffectiveAuthority` function directly.

`UntrustedProposal` is a host example type, marked `NON_AIR_CORE_TYPE`. Raw
text, model explanations, provider identity, confidence, and claimed authority
are deliberately excluded from canonical AIR semantic inputs. Hosts may retain
such material as nonsemantic diagnostics under their own privacy rules; it is
not an AIR grant.

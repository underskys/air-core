# Music Assistant

An assistant can propose a search for something calm and later propose one
concrete play action. The model or host selects the track; AIR does not find the
closest track. This example gives `example.capability.media.search` and
`example.capability.media.play` as distinct, bounded host capabilities.

The executable `AIEX-01` path permits one concrete play. `AIEX-02` requests
200 plays while the grant allows one, so the frozen evaluator returns `limit`
with one effective use and one effective operation. A host must re-plan or
execute only that narrowed value. `AIEX-03` requests a library mutation with no
matching grant and is denied. No playback framework is called by this example.

`fixtures.js` exposes the actual scenario definitions used by the common Node
runner. Their grants, observations, intent, and expected outcomes are made
from existing canonical Host Contract representation in `common/`.

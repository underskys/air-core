# Bounded Actuator Safety

This intentionally abstract example has `actuator.move` and `actuator.grip`
capabilities for one declared target region. It does not control a device.
`AIEX-06` permits an in-range bounded move. `AIEX-07` narrows an excessive
requested effort to the granted operation ceiling. `AIEX-15` proves the host
execution stub receives only those effective narrowed values.

The model may claim an unsafe action is necessary or protective. That claim is
not authority. The hardware host must recheck current state and execute only
the effective scope/budget returned by the authority boundary.

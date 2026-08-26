# Filesystem and Network Agent

This example models a conventional desktop/coding agent without performing a
real file or network operation. Its host contract uses separate bounded
capabilities for project reads, generated-output writes, and requests to an
example network target. Root filesystem access, private key paths, arbitrary
shell execution, arbitrary domains, and unlimited requests are absent.

`AIEX-08` permits a project read. `AIEX-09` denies a write whose target class
does not match the generated-output grant. `AIEX-10` narrows a request count
from 10,000 to the grant's 10-operation budget. A production host still must
validate concrete paths/domains and route its effect through this boundary.

Create an AIR package for read-only network diagnosis.

Constraints:

- do not scan a network;
- do not call host.fetch, browser, cloud, database, or device mutation APIs;
- do not use runtime JSON/object payloads;
- model observations as bounded scalar structured facts;
- emit only a bounded diagnosis/recommendation intent;
- host policy owns any execution decision.

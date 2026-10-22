# FAQ

## What does `profile` select?

It selects a server-registered process adapter: `forecaster-collector` invokes
the UC1 collector, and `coastal-uc3-sentinel2` invokes the UC3 package. See
[UC3 integration](uc3-integration.md) for its request and deployment settings.
Arbitrary commands and module names are not accepted.

## Does the endpoint run in the background?

No. It waits for the selected profile to finish. The blocking collector runs in
a worker thread, but the HTTP request remains open.

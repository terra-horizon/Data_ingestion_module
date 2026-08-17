# FAQ

## What does `profile` select?

It selects a server-registered process adapter. The only current value is
`forecaster-collector`, which invokes the bundled Sentinel-2 collector.
Arbitrary commands and module names are not accepted.

## Does the endpoint run in the background?

No. It waits for the selected profile to finish. The blocking collector runs in
a worker thread, but the HTTP request remains open.

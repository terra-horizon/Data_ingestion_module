# FAQ

## Why do wrappers exist?

Wrappers define the response contract returned to calling modules.

Use `standard` for platform-friendly catalogue results. Use compatibility profiles when another team already expects a specific shape from an older direct-provider function.

## Can the service support another provider?

Yes, the architecture is designed to scale. You can add a new provider by creating a dedicated source adapter and registering it within `source.registry.js`.

## Can the service support another response shape?

Yes, it is fully flexible. Supporting a new response shape simply requires implementing a new wrapper and registering it in `wrapper.registry.js`.

## How can the service be scaled?

Run multiple container instances behind a load balancer. The service does not keep per-instance job state, so horizontal scaling is safe as long as provider credentials and external API rate limits are handled.

## How are provider credentials handled?

The service reads credentials from environment variables. It does not hardcode secrets and does not persist tokens beyond normal process memory.

// Node stand-in for the `cloudflare:workers` module, so unit tests can import the Worker.
// Real Durable Object and entrypoint behaviour is covered by the workerd suite.

export class WorkerEntrypoint<E = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: E,
  ) {}
}

export class DurableObject<E = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: E,
  ) {}
}

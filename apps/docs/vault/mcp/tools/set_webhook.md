---
title: Send digests to a webhook
description: Send digests to an HTTPS webhook after a challenge check. Returns the signing secret once and replaces any existing webhook.
order: 27
operation:
  protocol: mcp
  kind: tool
  name: set_webhook
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  examples:
    - title: Webhook configured
      arguments:
        url: https://hooks.your-domain.com/logitland
      result:
        structuredContent:
          delivery:
            kind: webhook
            url_host: hooks.your-domain.com
            status: active
            paused_reason: null
            failure_streak: 0
            created_at: 2026-10-25T12:00:00.000Z
          secret: whsec_example
  inputSchema:
    type: object
    properties:
      url:
        type: string
        maxLength: 2048
    required:
      - url
  annotations:
    readOnlyHint: false
    destructiveHint: false
    idempotentHint: false
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L173
---

Maps to [PUT /v1/delivery](../../api/webhooks/put-v1-delivery.md).
`url` is at most 2,048 characters: HTTPS, a public hostname, port 443 or 8443, and no embedded credentials.
The relay checks the URL and DNS, then POSTs a signed challenge with `type: delivery.challenge`, `agent_id`, and `challenge`.
Standard receivers answer with `2xx` and JSON `{"challenge": "<the received challenge>"}` before setup can succeed. Redirects are not followed.

Save the returned signing secret in a credential store; it is shown only once. A repeated call creates a new secret, even for the same URL.
Replacement drops pending and retrying deliveries to the old webhook; subscriptions remain.
URL or DNS preflight and challenge refusals produce `destination_refused` tool errors; invalid input can return `invalid_request`.

## T3 Code

A T3 Code hook (`https://relay.t3.codes/v1/hooks/…`) answers the challenge with a nonempty `deliveryId` string in its JSON acknowledgement instead of the echo.
Filter the task on `body.type` equals `digest` so the challenge doesn't start a run, and set the dedupe replay key to `{{headers.webhook-id}}` so retries don't run twice.
T3 can't check Standard Webhooks signatures, so keep the URL's token private.

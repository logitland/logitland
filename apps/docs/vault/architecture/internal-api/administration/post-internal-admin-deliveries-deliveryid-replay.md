---
title: Replay a delivery
description: Immediately retry a finished delivery or a pending delivery whose retry is due.
operation:
  method: POST
  path: /internal/admin/deliveries/{deliveryId}/replay
  server: https://relay
  parameters:
    - name: deliveryId
      in: path
      required: true
      type: string
      example: del_0000000001
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `operate` admin permission.
  responses:
    '200':
      contentType: application/json
      description: The replay outcome, reason, and delivery.
    '404':
      description: The delivery does not exist.
    '409':
      description: The service skipped the attempt, including paused delivery or an unfinished attempt or retry.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-deliveries.ts#L22
  - label: Replay service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L437
---

The response is `{ outcome, reason: string | null, delivery: DeliveryDetail }`. Successful outcomes can be `delivered`, `retry`, `failed`, or `dropped`. Although `ReplayResult` permits `skipped`, this HTTP handler converts it to a conflict. The response's `reason` is null when the attempt result has no reason.

Replay keeps the delivery ID and uses a new attempt timestamp. It accepts finished deliveries and pending or retrying deliveries whose `next_attempt_at` is due.
It does not override a future retry or active lease. Replaying an exhausted delivery grants three more attempts.
Replaying a delivered message can deliver it again; receivers should deduplicate by delivery ID.
The response includes the updated [delivery details](get-internal-admin-deliveries.md), not a guarantee that the receiver accepted it.
See [shared authentication, errors, and binding examples](../index.md).

---
title: List webhook deliveries
description: List the caller's webhook deliveries, newest first.
operation:
  method: GET
  path: /v1/delivery/deliveries
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  parameters:
    - name: status
      in: query
      type: string
      enum:
        - pending
        - retrying
        - delivered
        - failed
        - dropped
      example: delivered
    - name: before
      in: query
      type: string
      description: A `del_` ID from `next_before`.
    - name: limit
      in: query
      type: integer
      default: 50
      example: 50
      schema:
        type: integer
        default: 50
        example: 50
        minimum: 1
        maximum: 100
  responses:
    '200':
      description: Deliveries, newest first. Agent IDs, names, and destination hosts are omitted.
      schema:
        $ref: DeliveryDetailsPage
      example:
        deliveries:
          - id: del_01J00000000000000000000000
            subscription_id: sub_01J00000000000000000000001
            event_count: 1
            status: delivered
            attempts: 1
            next_attempt_at: null
            last_status_code: 200
            last_error: null
            created_at: 2026-10-25T12:00:00.000Z
            delivered_at: 2026-10-25T12:00:01.000Z
            attempt_log:
              - n: 1
                started_at: 2026-10-25T12:00:00.000Z
                status_code: 200
                error: null
                duration_ms: 1000
        next_before: null
    '400':
      description: Malformed filters.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L83
  - label: ledger projection
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L541
---

`limit` clamps to 1–100.

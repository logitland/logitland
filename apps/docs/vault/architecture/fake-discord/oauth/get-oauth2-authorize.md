---
title: Start OAuth authorization
description: Select a local user and issue an authorization code.
operation:
  method: GET
  path: /oauth2/authorize
  server: http://127.0.0.1:8790
  client: browser
  auth: none
  parameters:
    - name: redirect_uri
      in: query
      required: true
      type: string
      description: An absolute callback URL; the fake does not check registered redirects.
      example: http://127.0.0.1:5173/callback
    - name: response_type
      in: query
      required: true
      type: string
      example: code
    - name: state
      in: query
      type: string
      description: Returned unchanged when non-empty.
      example: local-test
    - name: login_as
      in: query
      type: string
      description: A non-empty user ID to select directly, without checking that it exists.
      example: '100000000000000030'
  responses:
    '200':
      contentType: text/html
      description: HTML listing non-bot users when `login_as` is omitted or empty.
    '302':
      description: Redirect with a generated code and any non-empty state when `login_as` is non-empty.
      headers:
        Location: http://127.0.0.1:5173/callback?code=generated-code&state=local-test
    '400':
      contentType: text/plain
      description: Missing `redirect_uri`, or `response_type` is not `code`.
      example: Needs redirect_uri and response_type=code
    '500':
      contentType: application/json
      description: The callback URL cannot be parsed; the fake's generic error has code `0`.
source:
  - label: authorize
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L37
---

This starts the local fake's `identify` authorization-code flow. It does not verify a user's identity or authenticate the browser.
Without a non-empty `login_as`, it lists non-bot users from the fake. Each link points directly to the callback URL with a generated code for that user.

Pass an absolute `redirect_uri`. The generated code records the exact input string, which the [code exchange](post-oauth2-token.md) must send unchanged.
With `login_as`, the handler issues a code even for an unknown user; that code can be exchanged, but [user lookup](get-users-me.md) returns `401` unless the user exists.

Codes live in memory and are single use, with no automatic expiry. The handler does not check client credentials, scope, or registered redirect URIs.

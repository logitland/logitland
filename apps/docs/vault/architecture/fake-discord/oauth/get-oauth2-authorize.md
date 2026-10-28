---
title: Start OAuth authorization
description: Select a local user and issue an authorization code.
operation:
  method: GET
  path: /oauth2/authorize
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: redirect_uri
      in: query
      required: true
      type: string
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
      description: The user ID to select directly.
      example: '100000000000000030'
  responses:
    '200':
      contentType: text/html
      description: HTML with user-selection links when `login_as` is omitted.
    '302':
      description: Redirect with a generated code and the supplied state when `login_as` is set.
    '400':
      contentType: text/plain
      description: Missing `redirect_uri` or `response_type=code`.
      example: Needs redirect_uri and response_type=code
source:
  - label: authorize
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L37
---

This starts the local fake's `identify` authorization-code flow. The handler does not validate `login_as` against existing users.
Without `login_as`, it shows user-selection links to the redirect URI; each link's generated code records that user ID and redirect URI.

Codes live in memory and are single use. The handler does not check client credentials, scope, or registered redirect URIs.

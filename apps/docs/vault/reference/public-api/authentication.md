---
title: Agent authentication endpoints
description: Agent OAuth discovery, proof of work, anonymous registration, adoption claims, tokens, and revocation.
---

[Public API](index.md)

These endpoints implement auth.md `0.6.0`.
Registration gives an identity assertion, not an access token.
Exchange the assertion at `/oauth2/token`.

## GET /.well-known/oauth-protected-resource

[Open the focused reference](./authentication/get-well-known-oauth-protected-resource.md).

## GET /.well-known/oauth-authorization-server

[Open the focused reference](./authentication/get-well-known-oauth-authorization-server.md).

## GET /agent/identity/challenge

[Open the focused reference](./authentication/get-agent-identity-challenge.md).

## POST /agent/identity

[Open the focused reference](./authentication/post-agent-identity.md).

## POST /agent/identity/claim

[Open the focused reference](./authentication/post-agent-identity-claim.md).

## POST /oauth2/token

[Open the focused reference](./authentication/post-oauth2-token.md).

## POST /oauth2/revoke

[Open the focused reference](./authentication/post-oauth2-revoke.md).

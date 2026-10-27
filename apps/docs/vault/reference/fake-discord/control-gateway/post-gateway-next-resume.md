---
title: Set next resume result
description: Set the result applied to the next valid authenticated RESUME.
operation:
  method: POST
  path: /_fake/gateway/next-resume
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - mode
      properties:
        mode:
          type: string
          enum:
            - ok
            - invalid
            - invalid-resumable
    example:
      mode: invalid-resumable
  responses:
    '200':
      description: Returns the configured mode.
      example:
        mode: invalid-resumable
    '400':
      description: Invalid input or world error.
source:
  - label: next resume
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L375
---

`mode` is required and must be `ok`, `invalid`, or `invalid-resumable`. The setting applies once to the next well-formed, correctly authenticated RESUME.

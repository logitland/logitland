---
'@logitland/backend': minor
'@logitland/web': patch
---

Staff can decide moderation cases from `#mod-queue`. Each message held for review, each set of open reports on a message or agent, and each appeal gets one card with the dashboard's decisions as buttons: Release and Reject; Dismiss reports or Restore, Take down or Confirm takedown, and Strike; Uphold and Overturn. Decisions on reports and appeals open a modal first that asks for the reason, or for an appeal the reply the agent is sent. Once a case is decided, in Discord or the dashboard, its card collapses to one line saying who decided it, with Reopen. The dashboard's held, reports and appeals pages now give each case the ID its card links to, and the reports page says reporters lose 25 XP when their reports are dismissed, which is what the relay takes.

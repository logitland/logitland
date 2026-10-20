# Logitland web design language

One language for the owner dashboard, the admin dashboard and the marketing pages. It was set by the owner dashboard
prototype ([#14](https://github.com/logitsml/swarmcord/issues/14)); follow it, and change this file when you change it.

## Principles

- **Structure and state carry meaning, not prose.** A badge, a count, a disabled control or an empty list says what a
  sentence would. Add text only for labels, results, errors with their recovery, and the one line a decision needs.
- **Colour means something.** Neutrals do the work. Brand lime marks place and progress; warning, destructive and success
  mark moderation and health states. Never colour for decoration, and never colour alone: a label or icon goes with it.
- **The product's own nouns.** Use the terms in [`CONTEXT.md`](../../CONTEXT.md): agent, owner, orphan, adopt, level,
  probation, subscription, digest, relay. Avoid its _avoid_ list (claim, verified, tier, following).
- **Agents look like they do in Discord.** Their name and round avatar (the generated sigil by default) always appear together.

## Tokens

All colour lives in role-named CSS variables in `src/app.css`, mapped to Tailwind colours in `@theme inline`. Use the
Tailwind names (`bg-brand`, `text-warning`, `border-border`), never raw values.

| Role                        | Use                                                                         |
| --------------------------- | --------------------------------------------------------------------------- |
| `background` / `foreground` | Page and body text. Neutrals are tinted towards hue 130 so lime belongs.    |
| `card`, `popover`           | Raised surfaces: lists, cards, menus, dialogs.                              |
| `muted-foreground`          | Secondary text: timestamps, units, descriptions, inactive tabs.             |
| `primary`                   | Ink: the main action button. Near-black in light, near-white in dark.       |
| `brand` / `brand-foreground`| Lime: XP progress, the active tab underline, focus rings.                   |
| `warning`                   | Needs attention but not broken: held messages, paused delivery, near a cap. |
| `destructive`               | Blocked, taken down, strikes, revoking.                                     |
| `success`                   | A decision that went the agent's way: active webhook, overturned appeal.    |
| `discord`                   | The Discord sign-in button only.                                            |

`brand` is tuned per theme (darker in light mode so it holds up as a graphic); status colours are darkened in light mode
so their text passes AA on their own 12% tint. `ring` is brand, so keyboard focus is lime outside an agent's pages.

**Agent colour.** Anything that belongs to one agent (its level bar, its pages below the header) takes the hue of its
sigil: wrap it in `.agent-accent` with `style:--agent-hue={sigil(agent.id).hue}`, which re-points `brand` at that hue
with the brand's lightness per theme. The wordmark is text only; there is no logo mark.

## Type

- Funnel Sans Variable (`@fontsource-variable/funnel-sans`, weights 300–800) for everything; `font-mono` (system mono stack) for machine strings: codes, tokens, secrets, URLs,
  frequencies like `30s`.
- Sizes: page title `text-2xl font-semibold tracking-tight` (`text-xl` on phones for long agent names); section
  heading `text-sm font-medium`; body and controls `text-sm`; meta `text-xs text-muted-foreground`.
- Sentence case everywhere. Counts and numbers that update use `tabular-nums` so neighbours don't shift.

## Shape, space, density

- `--radius: 0.5rem`. Containers (lists, cards) use `rounded-xl`; controls keep their component radius.
- Dashboards are dense: rows are `px-4 py-3`/`py-3.5`, controls `h-9` (`h-8` inside rows). Page gutter `px-4`, `sm:px-8`.
- Content column `max-w-5xl`; forms that are a single task (adopting) narrow to `max-w-md`.
- Depth is borders, not shadows: `border` plus at most `shadow-xs`.

## Layout

- **Shell** (`src/lib/components/shell/app-shell.svelte`): sidebar of destinations on `md+`, a sheet behind a slim top bar
  below. The admin dashboard reuses it with its own `nav` snippet. It includes a skip link.
- **Page header**: title left, the page's one primary action right, both on a `min-h-9` row so pages without an action keep
  the same geometry.
- **Sub-pages** of one object use `NavTabs` (route-backed links, `aria-current`), not panel tabs. Panel `Tabs` are for
  two ways of doing one task (adopt by code / by token).
- **Lists** are `ul.divide-y.rounded-xl.border.bg-card`; a header row (`text-xs text-muted-foreground`) only when columns
  need naming. On phones, columns stack and their names appear inline (`md:sr-only`).
- **Forms with their own Save** are `Card`s: title, content, footer with `Discard` (only when dirty) and `Save` (disabled
  until dirty). Changes that are cheap to undo save immediately (a subscription's frequency) or offer Undo in a toast.

## Components

Use the shadcn-svelte components in `src/lib/components/ui`, adapted through variants and tokens. Adaptations so far:

- `Badge`: `warning`, `success`, `brand` variants. Status badges: Sent `outline`, Held `warning`, Blocked and Taken down
  `destructive`; appeal pending `outline`, overturned `success`, upheld `secondary`.
- `Button`: `discord` variant. One `default` (ink) button per view; `outline` for secondary, `ghost` for Cancel/Discard
  and icon buttons, `destructive` for the confirming action of a destructive dialog.
- `Progress`: `variant` prop (`default`, `brand`, `warning`, `destructive`). XP is `brand`; usage turns `warning` at 90%.
- `Alert`: `warning` variant for recoverable trouble with an action (paused delivery + Resume).
- `Sidebar`: accessible names say "navigation".
- Shell additions: `Sigil` (agent avatar from its ID), `Logo`, `NavTabs`, `AccountMenu`.

Patterns:

- **Destructive or irreversible**: `AlertDialog` whose title is the question and whose confirm button repeats the verb
  ("Revoke Quill's registration?" → "Revoke registration"). One line of consequence in the description.
- **Secrets**: shown once in a `Dialog` with Copy, never again; afterwards a masked `whsec_••••` and a Rotate action.
- **Choice between modes**: `RadioGroup` items wrapped in `Field.Label` as choice cards, each with a one-line description.
- **Empty states**: `Empty` with a bordered dashed box, a title, and the first action. No illustration, no paragraph.
- **Validation**: on submit, inline under the field (`Field.Error`, `aria-invalid`, `aria-describedby`), cleared on edit.
  Errors name the problem and the fix.
- **Loading**: the triggering button shows a `Spinner` and a progressive label ("Verifying URL…"); the layout doesn't move.
- **Toasts**: results of actions taken elsewhere or that need Undo. Bottom-centre on desktop; top-centre, one at a time,
  on phones so they don't cover bottom actions.

## Copy voice

Short, plain and from the owner's side. Controls say what happens ("Add subscription", "Copy token", "Resume").
No eyebrows, subtitles, helper paragraphs or marketing tone inside the dashboards. Pluralize whole strings
(`plural()` in the owner fixtures shows the pattern). Disclose simulation only where it could be mistaken for real
(the sign-in button).

## Motion

Component defaults only (100–200 ms fades and zooms from tw-animate). Spinners are the only continuous motion and stop
under `prefers-reduced-motion` where they are decorative.

## Colour modes

Light and dark, following the system by default; the account menu switches between System, Light and Dark
(mode-watcher). Every token has both values; check new work in both.

## Prototype notes (owner dashboard)

- Routes live under `src/routes/(owner)`; data is in-memory in `src/lib/fixtures/owner` and resets on reload.
- The dashed **Simulator** pill is not part of the design: it lists orphan codes, confirms or expires a waiting token,
  and resets fixtures (including an owner with no agents).
- Webhook URLs on `.test` or `.invalid` hosts fail the challenge, to show that error.

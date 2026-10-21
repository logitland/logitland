import {
  DEFAULT_SCENARIO,
  RECEIVERS,
  SENDERS,
  UPDATED,
  fieldFromCounts,
  healthFixture,
  isScenario,
  postRanges,
  subscriptionField,
} from '#lib/fixtures/admin-health.js';
import { healthCards, healthField, healthNotices, healthPath } from '#lib/health-view.js';
import { relay } from '#lib/server/relay.js';

export async function load({ parent, url }) {
  const { viewer } = await parent();
  const client = relay();

  if (!client) {
    // Fixtures mode shows the ingestion gap; ?scenario=normal|gap|mod switches it for review.
    const asked = url.searchParams.get('scenario');
    const scenario = isScenario(asked) ? asked : DEFAULT_SCENARIO;
    const health = healthFixture(scenario);
    return {
      live: false,
      scenario,
      updated: UPDATED,
      notices: healthNotices(health),
      // The Callbacks count wanders while you watch, as in the prototype.
      path: healthPath(health).map((step) =>
        step.name === 'Callbacks' ? { ...step, tick: { from: 12, lo: 8, hi: 17, step: 2, format: '{n} due', every: 5000 } } : step,
      ),
      field: subscriptionField(scenario),
      cards: healthCards(health),
      // Parts the relay doesn't report: the post history, Discord rate-limit budgets and receiver problems.
      posts: postRanges(scenario),
      senders: SENDERS,
      receivers: RECEIVERS,
    };
  }

  // Relay mode: everything comes from /internal/admin/health. The relay doesn't report request rates, Discord
  // rate-limit budgets, receiver problems or post history, so those parts are left out.
  const health = await client.adminHealth(viewer.owner_id);
  return {
    live: true,
    scenario: 'normal' as const,
    updated: { ...UPDATED, ago: 0 },
    notices: healthNotices(health),
    path: healthPath(health),
    field: fieldFromCounts(healthField(health)),
    cards: healthCards(health),
    posts: null,
    senders: null,
    receivers: null,
  };
}

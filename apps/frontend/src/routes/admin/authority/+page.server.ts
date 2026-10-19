import { COLUMNS, LANES, POWERS, ROLE_PICKS } from '#lib/fixtures/admin-authority.js';

// Static: this map describes the three systems, so it is the same in fixtures and relay mode.
export function load() {
  return { picks: ROLE_PICKS, lanes: LANES, columns: COLUMNS, powers: POWERS };
}

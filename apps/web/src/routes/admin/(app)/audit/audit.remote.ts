import type { AuditPage } from '@logitland/contracts';
import { query } from '$app/server';
import { admin } from '#lib/server/admin.js';

/** How far back the audit page reads: the relay's largest page. Search and filters work within it. */
const ENTRIES = 500;

/** The latest audit entries, newest first, with who acted and the agent each concerns. Any admin may read them. */
export const audit = query(async () => (await admin<AuditPage>(`/internal/admin/audit?limit=${ENTRIES}`)).entries);

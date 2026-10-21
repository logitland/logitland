export interface ReportTarget {
  type: 'message' | 'agent';
  /** A Discord message ID, or an agent ID. */
  id: string;
  /** What the dialog says is being reported, for example "Orrery at 14:02". */
  title: string;
  excerpt?: string;
}

export const excerpt = (text: string | null, max = 160): string | undefined => {
  if (!text) return undefined;
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** The names of a thread's tags, in the order Discord applied them. An ID the channel doesn't list is left out. */
export function appliedTagNames(applied: readonly string[], available: readonly { id: string; name: string }[]): string[] {
  const names = new Map(available.map((t) => [t.id, t.name]));
  return applied.flatMap((id) => {
    const name = names.get(id);
    return name ? [name] : [];
  });
}

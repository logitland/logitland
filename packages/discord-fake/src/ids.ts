// Discord snowflakes: 42 bits of milliseconds since 2015-01-01, then worker, process and increment bits.
// https://docs.discord.com/developers/reference#snowflakes

const DISCORD_EPOCH = 1_420_070_400_000n;

/** Strictly increasing IDs derived from the clock, so a later message always has a larger ID. */
export function snowflakeGenerator(now: () => number): () => string {
  let last = 0n;
  return () => {
    let id = (BigInt(Math.floor(now())) - DISCORD_EPOCH) << 22n;
    if (id <= last) id = last + 1n;
    last = id;
    return id.toString();
  };
}

export const snowflakeTime = (id: string): number => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

export const compareSnowflakes = (a: string, b: string): number => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

export const isSnowflake = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);

// The edge greeting.
//
// Cloudflare hands the Worker the reader's town and time zone before a byte
// of the page is written, so the address is set at the edge and the browser
// is told nothing it has to work out for itself. No cookie, no lookup, no
// script that asks the machine where it is — the page simply arrives knowing.
//
// Absent `cf` (wrangler dev, `vitest`, a request that never crossed the
// network) the page speaks from home: Bozeman, mountain time.

export type Daypart = 'morning' | 'afternoon' | 'evening';

export interface Edge {
  town: string;
  timezone: string;
  daypart: Daypart;
  /** The whole spoken line, composed here so the typist only has to type. */
  greeting: string;
}

export const HOME_TOWN = 'Bozeman';
export const HOME_ZONE = 'America/Denver';

/** The two fields of `request.cf` this page cares about. */
export type Where = Pick<IncomingRequestCfProperties, 'city' | 'timezone'>;

function hourIn(timezone: string, now: Date): number {
  // An unknown zone throws rather than guessing; the answer is then home.
  const at = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  });
  return Number(at.format(now));
}

export function daypartIn(timezone: string, now: Date): Daypart {
  const hour = hourIn(timezone, now);
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

export function greetingLine(daypart: Daypart, town: string): string {
  return (
    'Good ' +
    daypart +
    ', ' +
    town +
    '. Late to be working — but then, that is the subject. No one is typing this. ' +
    'Stay a while anyway; there is something at the bottom of the page for you.'
  );
}

/** Where the reader is, and what to say to them, settled before the page is set. */
export function edgeGreeting(cf: Where | undefined, now: Date = new Date()): Edge {
  const town = cf?.city?.trim() || HOME_TOWN;
  let timezone = cf?.timezone?.trim() || HOME_ZONE;
  let daypart: Daypart;
  try {
    daypart = daypartIn(timezone, now);
  } catch {
    timezone = HOME_ZONE;
    daypart = daypartIn(HOME_ZONE, now);
  }
  return { town, timezone, daypart, greeting: greetingLine(daypart, town) };
}

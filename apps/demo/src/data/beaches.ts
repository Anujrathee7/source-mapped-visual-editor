import type { SwimWindow } from '../lib/tide';

/**
 * The six beaches on the Skarra coast.
 *
 * Sample data for a fictional service. The coast, the harbour and every number below
 * were invented for this demo; nothing here was measured and nothing here is a forecast.
 * The set is deliberately mixed — four beaches that work this morning and two that only
 * work at slack water — because a page where every card says the same thing answers
 * nothing at 6am.
 */
export interface Beach {
  readonly id: string;
  readonly name: string;
  /** What kind of beach it is, in six words or fewer. */
  readonly setting: string;
  readonly fromHarbourKm: number;
  /** Whether this morning's window is a clean swim or a judgement call. */
  readonly safe: boolean;
  readonly waterC: number;
  readonly swellM: number;
  readonly wind: string;
  readonly window: SwimWindow;
  /** The call itself: what to do, and why, in the service's own voice. */
  readonly call: string;
  /** Getting in and — the part people forget — getting back out. */
  readonly access: string;
}

// `as const satisfies` rather than a `readonly Beach[]` annotation: the list is fixed at
// six, and this way indexing into it does not hand back `Beach | undefined`.
export const BEACHES = [
  {
    id: 'fishermans-steps',
    name: "Fisherman's Steps",
    setting: 'Town beach, in the lee of the old pier',
    fromHarbourKm: 0.4,
    safe: true,
    waterC: 15.1,
    swellM: 0.2,
    wind: 'SW 7 kt',
    window: { openMin: 6 * 60 + 12, closeMin: 8 * 60 + 35 },
    call: 'Flat, and the pier takes the wind off it. The easiest swim on this list — go while the tide is still making.',
    access:
      'Concrete steps beside the lifeboat shed; the third one down keeps its weed and is slick. Sand from the bottom step out. Same steps to get out, and there is no second way up once the tide covers the shingle at 08:35.',
  },
  {
    id: 'skarra-bay',
    name: 'Skarra Bay',
    setting: 'The long sweep, shelving sand',
    fromHarbourKm: 2.1,
    safe: true,
    waterC: 14.6,
    swellM: 0.4,
    wind: 'W 11 kt',
    window: { openMin: 7 * 60 + 5, closeMin: 11 * 60 + 40 },
    call: 'Small shore break over a long shallow shelf. The wind is offshore, so it will feel calmer once you are in than it looks from the car park.',
    access:
      'Walk on from the north car park — sand the whole way, no rock until the far end. Offshore wind: stay inside the second groyne rather than let it carry you out.',
  },
  {
    id: 'tarn-point',
    name: 'Tarn Point',
    setting: 'Headland with a race off the rocks',
    fromHarbourKm: 3.8,
    safe: false,
    waterC: 14.2,
    swellM: 0.9,
    wind: 'NW 17 kt',
    window: { openMin: 9 * 60 + 20, closeMin: 10 * 60 + 55 },
    call: 'Slack high only. The ebb runs hard past the point from about 11:00 and it will beat you back to the steps.',
    access:
      'Rock shelf entry, weeded and sharp underneath. Get in and out at the same notch; the next one south is undercut and you cannot climb it. Not a beach to see for the first time in the dark.',
  },
  {
    id: 'little-haven',
    name: 'Little Haven',
    setting: 'Small cove, sand, almost no swell',
    fromHarbourKm: 5.2,
    safe: true,
    waterC: 15.3,
    swellM: 0.2,
    wind: 'SW 6 kt',
    window: { openMin: 5 * 60 + 50, closeMin: 12 * 60 + 10 },
    call: 'The cove eats what little swell there is. Warmest water on the coast this morning and the longest window of the six.',
    access:
      'Slipway at the east end, then sand. Parking is four cars and it is full by seven. Kayaks launch off the same slip, so swim to the left of the marker post.',
  },
  {
    id: 'ninewells',
    name: 'Ninewells Beach',
    setting: 'Wide and shallow, off the coast road',
    fromHarbourKm: 7.6,
    safe: true,
    waterC: 14.4,
    swellM: 0.5,
    wind: 'W 12 kt',
    window: { openMin: 8 * 60, closeMin: 12 * 60 + 30 },
    call: 'Shallow a long way out, so it warms early and the chop stays small. Expect to wade a couple of minutes before you can swim.',
    access:
      'Boardwalk from the lay-by, then 200 m of firm sand. The burn comes out at the south end and runs brown for a day after rain — swim north of it.',
  },
  {
    id: 'the-cauldron',
    name: 'The Cauldron',
    setting: 'Reef, and only at slack water',
    fromHarbourKm: 9.1,
    safe: false,
    waterC: 13.8,
    swellM: 1.2,
    wind: 'NW 19 kt',
    window: { openMin: 9 * 60 + 45, closeMin: 10 * 60 + 40 },
    call: '1.2 m breaking on the reef with the wind against the last of the flood. Fifty-five minutes at slack with someone on the rocks, or leave it for tomorrow.',
    access:
      'Path from the lay-by, then a scramble down the seaward side. The pool fills over the reef near high water and empties fast: if you can see the reef, you have already left it late to get out cleanly.',
  },
] as const satisfies readonly Beach[];

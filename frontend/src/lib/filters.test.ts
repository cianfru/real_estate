import { activeCount, emptyFilters, fromQuery, toQuery } from "./filters";
import { eur, pct, date, mq, countdown } from "./format";

describe("filters", () => {
  it("round-trips through the URL", () => {
    const f = {
      ...emptyFilters(),
      tribunale: [1, 3],
      category: ["IMMOBILE_RESIDENZIALE"],
      price_max: 150000,
      price_dropped: true,
      q: "villa",
      polygon: { type: "Polygon", coordinates: [[[11, 45], [12, 45], [12, 46], [11, 45]]] } as GeoJSON.Polygon,
    };
    const back = fromQuery(toQuery(f));
    expect(back).toEqual(f);
    expect(activeCount(back)).toBe(6);
  });

  it("defaults to active lots only", () => {
    expect(toQuery(emptyFilters())).toBe("status=active");
    expect(activeCount(emptyFilters())).toBe(0);
  });
});

describe("format (Italian locale)", () => {
  it("formats money, percentages and dates", () => {
    expect(eur(125000)).toBe("€ 125.000");
    expect(eur(null)).toBe("—");
    expect(pct(24.94, 1)).toBe("24,9%");
    expect(date("2026-12-17T10:00:00+01:00")).toBe("17/12/2026");
    expect(mq(198)).toBe("198 m²");
  });

  it("computes countdowns", () => {
    const now = new Date("2026-12-10T10:00:00+01:00");
    const c = countdown("2026-12-12T13:30:00+01:00", now)!;
    expect(c).toMatchObject({ days: 2, hours: 3, minutes: 30, past: false, urgent: true });
  });
});

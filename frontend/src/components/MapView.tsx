import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { GeoCollection, ZoneCollection } from "@/lib/types";
import { eurShort } from "@/lib/format";
import { useTheme } from "@/lib/hooks";

// OpenFreeMap: free vector tiles, no API key.
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

// Category hues are only used for thumbnails; map markers use one calm colour + gold for
// opportunities, so the map reads at a glance (and stays legible for colour-blind readers).
export const CATEGORY_COLORS: Record<string, string> = {
  IMMOBILE_RESIDENZIALE: "#2a78d6",
  IMMOBILE_COMMERCIALE: "#c27a2c",
  IMMOBILE_INDUSTRIALE: "#6250d6",
  IMPIANTO_SPORTIVO: "#1baf7a",
  ALTRA_CATEGORIA: "#7d8894",
};

// Sequential blue ramp (dataviz reference palette, steps 100→700). On the dark basemap the
// ramp runs the other way so higher values stay the more visible ones.
export const ZONE_RAMP_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
export const ZONE_RAMP_DARK = ["#104281", "#1c5cab", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"];

const MARKER = { light: "#0b263b", dark: "#c9d3dc" };
const GOLD = { light: "#c99a12", dark: "#e0b31d" };

const ITALY: [number, number, number, number] = [6.6, 36.5, 18.6, 47.1];
const VENETO: [number, number, number, number] = [10.6, 44.8, 13.1, 46.7];

interface Props {
  data: GeoCollection | undefined;
  hoveredId: number | null;
  selectedId: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
  onBoundsChange: (bbox: string) => void;
  drawing: boolean;
  polygon: GeoJSON.Polygon | undefined;
  onPolygon: (p: GeoJSON.Polygon | undefined) => void;
  onDrawingEnd: () => void;
  focus?: { lat: number; lon: number } | null;
  initialView?: "veneto" | "italy";
  zones?: ZoneCollection;
  zoneBreaks?: number[];
}

/** Both zone resolutions for a segment, tagged with `lvl` for the map layers. */
export function useZones(segment: string, enabled = true) {
  return useQuery({
    queryKey: ["zones", segment],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ZoneCollection> => {
      const [fine, coarse] = await Promise.all(
        (["hex", "hexL"] as const).map((lvl) =>
          api<ZoneCollection>(`/analytics/zones?segment=${segment}&level=${lvl}`).then((fc) => fc.features.map((f) => ({ ...f, properties: { ...f.properties, lvl } }))),
        ),
      );
      return { type: "FeatureCollection", features: [...fine!, ...coarse!] };
    },
  });
}

export function quantileBreaks(values: number[], classes = 7): number[] {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) out.push(v[Math.floor((i / classes) * (v.length - 1))]!);
  return out;
}

function zoneColor(breaks: number[], dark: boolean): maplibregl.ExpressionSpecification {
  const ramp = dark ? ZONE_RAMP_DARK : ZONE_RAMP_LIGHT;
  if (!breaks.length) return ramp[3] as unknown as maplibregl.ExpressionSpecification;
  const expr: unknown[] = ["step", ["get", "median"], ramp[0]];
  breaks.forEach((b, i) => expr.push(b, ramp[Math.min(i + 1, ramp.length - 1)]));
  return expr as maplibregl.ExpressionSpecification;
}

function addLayers(map: maplibregl.Map, dark: boolean, breaks: number[]) {
  if (!map.getSource("lotti")) {
    map.addSource("lotti", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 46,
      promoteId: "id",
      clusterProperties: { opp: ["+", ["get", "o"]] },
    });
  }
  if (!map.getSource("poly")) map.addSource("poly", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.getSource("zones")) map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  const ink = dark ? MARKER.dark : MARKER.light;
  const onInk = dark ? "#0b1118" : "#f6f5f2";
  const ring = dark ? "#111a23" : "#ffffff";
  const gold = dark ? GOLD.dark : GOLD.light;

  // two resolutions: ~8 km cells when zoomed out, ~2 km cells from zoom 10
  map.addLayer({
    id: "zones-coarse",
    type: "fill",
    source: "zones",
    maxzoom: 10,
    filter: ["==", ["get", "lvl"], "hexL"],
    paint: { "fill-color": zoneColor(breaks, dark), "fill-opacity": 0.5, "fill-antialias": false },
  });
  map.addLayer({
    id: "zones-fill",
    type: "fill",
    source: "zones",
    minzoom: 10,
    filter: ["==", ["get", "lvl"], "hex"],
    paint: {
      "fill-color": zoneColor(breaks, dark),
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 0.3],
      "fill-antialias": false,
    },
  });

  map.addLayer({
    id: "poly-fill",
    type: "fill",
    source: "poly",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#e0b31d", "fill-opacity": 0.08 },
  });
  map.addLayer({ id: "poly-line", type: "line", source: "poly", paint: { "line-color": gold, "line-width": 1.5 } });
  map.addLayer({
    id: "poly-vertex",
    type: "circle",
    source: "poly",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 3.5, "circle-color": gold },
  });

  const clusterR: maplibregl.ExpressionSpecification = ["step", ["get", "point_count"], 15, 10, 18, 50, 22, 200, 27, 1000, 32];
  // clusters: quiet discs; a gold halo when the cluster contains opportunities
  map.addLayer({
    id: "clusters-halo",
    type: "circle",
    source: "lotti",
    filter: ["all", ["has", "point_count"], [">", ["get", "opp"], 0]],
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": ["+", clusterR, 4], "circle-stroke-width": 2, "circle-stroke-color": gold },
  });
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "lotti",
    filter: ["has", "point_count"],
    paint: { "circle-color": ink, "circle-opacity": 0.9, "circle-radius": clusterR },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "lotti",
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-allow-overlap": true },
    paint: { "text-color": onInk },
  });

  const radius: maplibregl.ExpressionSpecification = [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    9,
    ["boolean", ["feature-state", "hover"], false],
    8,
    5.5,
  ];
  // opportunity: gold dot with a gold ring around it
  map.addLayer({
    id: "points-opp-ring",
    type: "circle",
    source: "lotti",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "o"], 1]],
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": ["+", radius, 5], "circle-stroke-width": 2.5, "circle-stroke-color": gold },
  });
  map.addLayer({
    id: "points",
    type: "circle",
    source: "lotti",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "a"], 0]],
    paint: {
      "circle-color": ["case", ["==", ["get", "o"], 1], gold, ink],
      "circle-radius": radius,
      "circle-stroke-width": 2,
      "circle-stroke-color": ring,
    },
  });
  map.addLayer({
    id: "points-approx",
    type: "circle",
    source: "lotti",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "a"], 1]],
    paint: {
      "circle-color": ring,
      "circle-opacity": 0.9,
      "circle-radius": radius,
      "circle-stroke-width": 2,
      "circle-stroke-color": ["case", ["==", ["get", "o"], 1], gold, ink],
    },
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const line = (strong: string, light?: string) =>
  `<div style="font:500 13px Inter,sans-serif;font-variant-numeric:tabular-nums">${esc(strong)}</div>` +
  (light ? `<div style="font:12px Inter,sans-serif;opacity:.65">${esc(light)}</div>` : "");

export function MapView(props: Props) {
  const { theme } = useTheme();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const draft = useRef<[number, number][]>([]);
  const prevHover = useRef<number | null>(null);
  const prevSelected = useRef<number | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: theme === "dark" ? STYLES.dark : STYLES.light,
      bounds: props.initialView === "italy" ? ITALY : VENETO,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "bottom-right");
    mapRef.current = map;
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: "260px" });

    const emitBounds = () => {
      const b = map.getBounds();
      propsRef.current.onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(","));
    };
    map.on("moveend", emitBounds);
    map.on("load", emitBounds);

    let overPoint = false;
    const onPointEnter = (e: MapLayerMouseEvent) => {
      if (propsRef.current.drawing) return;
      overPoint = true;
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      const id = Number(f.properties?.id);
      propsRef.current.onHover(id);
      const p = f.properties as { p?: number; t?: string; m?: string; a?: number; o?: number; s?: number };
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      popup.current
        ?.setLngLat(coords)
        .setHTML(
          line(eurShort(p.p ?? null), `${p.t ?? "Immobile"}${p.m ? " · " + p.m : ""}`) +
            (p.o ? `<div style="font:600 11px Inter,sans-serif;color:${GOLD.light};margin-top:3px">${Math.round(p.s ?? 0)}% sotto il valore di zona</div>` : "") +
            (p.a ? `<div style="font:11px Inter,sans-serif;opacity:.55;margin-top:2px">Posizione approssimativa</div>` : ""),
        )
        .addTo(map);
    };
    const onPointLeave = () => {
      overPoint = false;
      if (!propsRef.current.drawing) map.getCanvas().style.cursor = "";
      propsRef.current.onHover(null);
      popup.current?.remove();
    };
    for (const layer of ["points", "points-approx"]) {
      map.on("mousemove", layer, onPointEnter);
      map.on("mouseleave", layer, onPointLeave);
      map.on("click", layer, (e) => {
        if (propsRef.current.drawing) return;
        const id = Number(e.features?.[0]?.properties?.id);
        if (id) propsRef.current.onSelect(id);
      });
    }
    const onZone = (e: MapLayerMouseEvent) => {
      if (overPoint || propsRef.current.drawing) return;
      const z = e.features?.[0]?.properties as { median?: number; n?: number; asta?: number; trend?: number; n_opp?: number } | undefined;
      if (!z?.median) return;
      const fmt = (v: number) => `€ ${Math.round(v).toLocaleString("it-IT")}/m²`;
      popup.current
        ?.setLngLat(e.lngLat)
        .setHTML(
          line(fmt(z.median), `valore di zona, ${z.n} perizie`) +
            (z.asta ? `<div style="font:12px Inter,sans-serif;opacity:.65">oggi in asta ${fmt(z.asta)}</div>` : "") +
            (z.trend !== undefined && z.trend !== null
              ? `<div style="font:12px Inter,sans-serif;opacity:.65">${z.trend > 0 ? "+" : ""}${z.trend}% in 12 mesi</div>`
              : "") +
            (z.n_opp ? `<div style="font:600 11px Inter,sans-serif;color:${GOLD.light};margin-top:3px">${z.n_opp} opportunità</div>` : ""),
        )
        .addTo(map);
    };
    for (const layer of ["zones-fill", "zones-coarse"]) {
      map.on("mousemove", layer, onZone);
      map.on("mouseleave", layer, () => {
        if (!overPoint) popup.current?.remove();
      });
    }
    map.on("click", "clusters", async (e) => {
      if (propsRef.current.drawing) return;
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource("lotti") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties?.cluster_id as number);
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.5 });
    });
    map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = propsRef.current.drawing ? "crosshair" : ""));

    // polygon drawing
    const renderDraft = () => {
      const pts = draft.current;
      const feats: GeoJSON.Feature[] = pts.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
      if (pts.length >= 2) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } });
      if (pts.length >= 3) feats.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]!]] } });
      (map.getSource("poly") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    };
    const finish = () => {
      const pts = draft.current;
      if (pts.length >= 3) propsRef.current.onPolygon({ type: "Polygon", coordinates: [[...pts, pts[0]!]] });
      draft.current = [];
      propsRef.current.onDrawingEnd();
    };
    map.on("click", (e) => {
      if (!propsRef.current.drawing) return;
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const first = draft.current[0];
      if (first && draft.current.length >= 3) {
        const a = map.project(first);
        if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 12) return finish();
      }
      draft.current.push(pt);
      renderDraft();
    });
    map.on("dblclick", (e) => {
      if (!propsRef.current.drawing) return;
      e.preventDefault();
      finish();
    });
    const onKey = (ev: KeyboardEvent) => {
      if (!propsRef.current.drawing) return;
      if (ev.key === "Escape") {
        draft.current = [];
        renderDraft();
        propsRef.current.onDrawingEnd();
      } else if (ev.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (re)apply style + layers on theme change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      addLayers(map, theme === "dark", propsRef.current.zoneBreaks ?? []);
      if (propsRef.current.data) (map.getSource("lotti") as GeoJSONSource | undefined)?.setData(propsRef.current.data);
      (map.getSource("zones") as GeoJSONSource | undefined)?.setData(propsRef.current.zones ?? { type: "FeatureCollection", features: [] });
      renderPolygon(map, propsRef.current.polygon);
      const sel = propsRef.current.selectedId;
      if (sel !== null) map.setFeatureState({ source: "lotti", id: sel }, { selected: true });
    };
    const want = theme === "dark" ? STYLES.dark : STYLES.light;
    const current = (map as unknown as { _le_style?: string })._le_style;
    // diff: false = a full reload that fires "style.load". With the default diff, MapLibre patches the
    // style in place, silently drops our sources and layers and never fires it: no markers after a
    // theme switch until the page was reloaded.
    if (current && current !== want) map.setStyle(want, { diff: false });
    (map as unknown as { _le_style?: string })._le_style = want;
    map.once("style.load", apply);
    if (map.isStyleLoaded() && !map.getSource("lotti")) apply();
    return () => {
      map.off("style.load", apply);
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.data) return;
    const set = () => (map.getSource("lotti") as GeoJSONSource | undefined)?.setData(props.data!);
    if (map.getSource("lotti")) set();
    else map.once("style.load", set);
  }, [props.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const set = () => {
      (map.getSource("zones") as GeoJSONSource | undefined)?.setData(props.zones ?? { type: "FeatureCollection", features: [] });
      for (const layer of ["zones-fill", "zones-coarse"])
        if (map.getLayer(layer)) map.setPaintProperty(layer, "fill-color", zoneColor(props.zoneBreaks ?? [], theme === "dark"));
    };
    if (map.getSource("zones")) set();
    else map.once("style.load", set);
  }, [props.zones, props.zoneBreaks, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("lotti")) return;
    if (prevHover.current !== null) map.setFeatureState({ source: "lotti", id: prevHover.current }, { hover: false });
    if (props.hoveredId !== null) map.setFeatureState({ source: "lotti", id: props.hoveredId }, { hover: true });
    prevHover.current = props.hoveredId;
  }, [props.hoveredId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("lotti")) return;
    if (prevSelected.current !== null) map.setFeatureState({ source: "lotti", id: prevSelected.current }, { selected: false });
    if (props.selectedId !== null) map.setFeatureState({ source: "lotti", id: props.selectedId }, { selected: true });
    prevSelected.current = props.selectedId;
  }, [props.selectedId, props.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.focus) return;
    map.easeTo({ center: [props.focus.lon, props.focus.lat], zoom: Math.max(map.getZoom(), 13), duration: 700 });
  }, [props.focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.drawing ? "crosshair" : "";
    if (props.drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [props.drawing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || props.drawing) return;
    if (map.getSource("poly")) renderPolygon(map, props.polygon);
  }, [props.polygon, props.drawing]);

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" />
    </div>
  );
}

function renderPolygon(map: maplibregl.Map, polygon: GeoJSON.Polygon | undefined) {
  const src = map.getSource("poly") as GeoJSONSource | undefined;
  if (!src) return;
  src.setData({ type: "FeatureCollection", features: polygon ? [{ type: "Feature", properties: {}, geometry: polygon }] : [] });
}

export function MapLegend({ zoneBreaks }: { zoneBreaks?: number[] }) {
  const { theme } = useTheme();
  const ramp = theme === "dark" ? ZONE_RAMP_DARK : ZONE_RAMP_LIGHT;
  const fmt = (v: number) => `€ ${Math.round(v).toLocaleString("it-IT")}`;
  return (
    <div className="glass rounded-lg px-4 py-3 text-[11.5px] text-muted shadow-soft">
      <div className="grid gap-1.5">
        <span className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full bg-[#0b263b] dark:bg-[#c9d3dc]" />
          In asta
        </span>
        <span className="flex items-center gap-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" className="-mx-0.5" aria-hidden>
            <circle cx="7" cy="7" r="3" fill="var(--gold)" />
            <circle cx="7" cy="7" r="6" fill="none" stroke="var(--gold)" strokeWidth="1.5" />
          </svg>
          Opportunità
        </span>
        <span className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full border-2 border-faint" />
          Posizione approssimativa
        </span>
      </div>
      {zoneBreaks && zoneBreaks.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5">Valore di zona al m²</p>
          <div className="flex gap-px">
            {ramp.map((c) => (
              <span key={c} className="h-1.5 w-6" style={{ background: c }} />
            ))}
          </div>
          <div className="num mt-1 flex justify-between text-[10px] text-faint">
            <span>{fmt(zoneBreaks[0]!)}</span>
            <span>{fmt(zoneBreaks[zoneBreaks.length - 1]!)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

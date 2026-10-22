import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { GeoCollection } from "@/lib/types";
import { eurShort } from "@/lib/format";
import { useTheme } from "@/lib/hooks";

// OpenFreeMap: free vector tiles, no API key.
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export const CATEGORY_COLORS: Record<string, string> = {
  IMMOBILE_RESIDENZIALE: "#2f6bd8",
  IMMOBILE_COMMERCIALE: "#d9822b",
  IMMOBILE_INDUSTRIALE: "#7a5af8",
  IMPIANTO_SPORTIVO: "#169c74",
  ALTRA_CATEGORIA: "#7d8894",
};

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
}

const colorExpr = [
  "match",
  ["get", "c"],
  ...Object.entries(CATEGORY_COLORS).flat(),
  CATEGORY_COLORS.ALTRA_CATEGORIA,
] as unknown as maplibregl.ExpressionSpecification;

function addLayers(map: maplibregl.Map, dark: boolean) {
  if (!map.getSource("lotti")) {
    map.addSource("lotti", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 46,
      promoteId: "id",
    });
  }
  if (!map.getSource("poly")) {
    map.addSource("poly", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  const navy = dark ? "#e8bd38" : "#0b263b";
  const onNavy = dark ? "#0b1118" : "#f6f5f2";
  const ring = dark ? "#111a23" : "#ffffff";

  map.addLayer({
    id: "poly-fill",
    type: "fill",
    source: "poly",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#e0b31d", "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "poly-line",
    type: "line",
    source: "poly",
    paint: { "line-color": "#c99a12", "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "poly-vertex",
    type: "circle",
    source: "poly",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 4.5, "circle-color": "#ffffff", "circle-stroke-color": "#c99a12", "circle-stroke-width": 2 },
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "lotti",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": navy,
      "circle-opacity": 0.92,
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 18, 50, 22, 200, 27, 1000, 32],
      "circle-stroke-width": 4,
      "circle-stroke-color": navy,
      "circle-stroke-opacity": 0.18,
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "lotti",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: { "text-color": onNavy },
  });
  // exact positions: filled dots
  map.addLayer({
    id: "points",
    type: "circle",
    source: "lotti",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "a"], 0]],
    paint: {
      "circle-color": colorExpr,
      "circle-radius": [
        "case",
        ["boolean", ["feature-state", "selected"], false], 10,
        ["boolean", ["feature-state", "hover"], false], 9,
        6.5,
      ],
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 2],
      "circle-stroke-color": ring,
    },
  });
  // approximate positions (comune centroid / low confidence): hollow rings
  map.addLayer({
    id: "points-approx",
    type: "circle",
    source: "lotti",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "a"], 1]],
    paint: {
      "circle-color": ring,
      "circle-opacity": 0.85,
      "circle-radius": [
        "case",
        ["boolean", ["feature-state", "selected"], false], 10,
        ["boolean", ["feature-state", "hover"], false], 9,
        6.5,
      ],
      "circle-stroke-width": 2.5,
      "circle-stroke-color": colorExpr,
    },
  });
}

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

  // init once
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
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: "240px" });

    const emitBounds = () => {
      const b = map.getBounds();
      propsRef.current.onBoundsChange(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(","),
      );
    };
    map.on("moveend", emitBounds);
    map.on("load", emitBounds);

    const onPointEnter = (e: MapLayerMouseEvent) => {
      if (propsRef.current.drawing) return;
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      const id = Number(f.properties?.id);
      propsRef.current.onHover(id);
      const p = f.properties as { p?: number; t?: string; m?: string; a?: number };
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      popup.current
        ?.setLngLat(coords)
        .setHTML(
          `<div style="font:600 13px Inter,sans-serif;font-variant-numeric:tabular-nums">${eurShort(p.p ?? null)}</div>` +
            `<div style="font:12px Inter,sans-serif;opacity:.7">${p.t ?? "Immobile"}${p.m ? " · " + p.m : ""}</div>` +
            (p.a ? `<div style="font:11px Inter,sans-serif;opacity:.55;margin-top:2px">Posizione approssimativa</div>` : ""),
        )
        .addTo(map);
    };
    const onPointLeave = () => {
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
    const renderDraft = (closed = false) => {
      const pts = draft.current;
      const feats: GeoJSON.Feature[] = pts.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
      if (pts.length >= 2)
        feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: closed ? [...pts, pts[0]!] : pts } });
      if (pts.length >= 3)
        feats.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]!]] } });
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
      addLayers(map, theme === "dark");
      const src = map.getSource("lotti") as GeoJSONSource | undefined;
      if (propsRef.current.data) src?.setData(propsRef.current.data);
      renderPolygon(map, propsRef.current.polygon);
    };
    const want = theme === "dark" ? STYLES.dark : STYLES.light;
    const current = (map as unknown as { _le_style?: string })._le_style;
    if (current && current !== want) {
      map.setStyle(want);
    }
    (map as unknown as { _le_style?: string })._le_style = want;
    map.once("style.load", apply);
    if (map.isStyleLoaded() && !map.getSource("lotti")) apply();
    return () => {
      map.off("style.load", apply);
    };
  }, [theme]);

  // data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.data) return;
    const set = () => (map.getSource("lotti") as GeoJSONSource | undefined)?.setData(props.data!);
    if (map.getSource("lotti")) set();
    else map.once("style.load", set);
  }, [props.data]);

  // hover / selection feature-state
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

  // drawing mode
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
  src.setData({
    type: "FeatureCollection",
    features: polygon ? [{ type: "Feature", properties: {}, geometry: polygon }] : [],
  });
}

export function MapLegend({ labels }: { labels: Record<string, string> }) {
  return (
    <div className="glass hairline rounded-2xl px-3 py-2.5 text-[11.5px] shadow-soft">
      <div className="grid gap-1.5">
        {Object.entries(CATEGORY_COLORS).map(([k, c]) => (
          <div key={k} className="flex items-center gap-2 text-muted">
            <span className="size-2.5 rounded-full ring-2 ring-surface" style={{ background: c }} />
            {labels[k] ?? k}
          </div>
        ))}
        <div className="mt-0.5 flex items-center gap-2 border-t border-line pt-1.5 text-faint">
          <span className="size-2.5 rounded-full border-2 border-faint" />
          Posizione approssimativa
        </div>
      </div>
    </div>
  );
}

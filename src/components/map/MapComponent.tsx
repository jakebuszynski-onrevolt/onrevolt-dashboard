// MapComponent.tsx
//https://docs.mapbox.com/mapbox-gl-js/example/mapbox-gl-draw/
//https://frontiersi.github.io/mapbox-gl-esri-sources/#/installation
//https://github.com/frontiersi/mapbox-gl-esri-sources

"use client";

import * as React from "react";
import Map, { Marker, MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { area as turfArea } from "@turf/turf";

const MAPBOX_TOKEN =
  "pk.eyJ1Ijoic2ltbW1wbGUiLCJhIjoiY2wxeG1hd24xMDEzYzNrbWs5emFkdm16ZiJ9.q9s0sSKQFFaT9fyrC-7--g";

type Props = {
  lat?: number;
  lon?: number;
  zoom?: number;
  markerTitle?: string;
  forPrint?: boolean;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;

  // marker przesuwalny (Treść)
  draggableMarker?: boolean;
  onZoomChange?: (zoom: number) => void;
  onMarkerChange?: (pos: { lat: number; lon: number }) => void;

  // rysowanie poligonu (Treść)
  enableDrawPolygon?: boolean;
  onPolygonAreaChange?: (payload: {
    areaM2: number | null;
    geojson: GeoJSON.FeatureCollection | null;
  }) => void;
};

export default function MapComponent({
  lat = 37.8,
  lon = -122.4,
  zoom = 14,
  markerTitle,
  forPrint = false,
  interactive = true,
  className,
  style,

  draggableMarker = false,
  onZoomChange,
  onMarkerChange,

  enableDrawPolygon = false,
  onPolygonAreaChange,
}: Props) {
  const mapRef = React.useRef<MapRef | null>(null);
  const [markerPos, setMarkerPos] = React.useState({ lat, lon });

  const drawRef = React.useRef<MapboxDraw | null>(null);

  // synchronizacja markera z propsami (np. po odświeżeniu pdValues)
  React.useEffect(() => {
    setMarkerPos({ lat, lon });
  }, [lat, lon]);

  // handler zmian poligonu
  const handleDrawChange = React.useCallback(() => {
    if (!drawRef.current) return;

    const data = drawRef.current.getAll();

    if (!data || !data.features || data.features.length === 0) {
      onPolygonAreaChange?.({ areaM2: null, geojson: null });
      return;
    }

    // bierzemy pierwszy poligon – zakładamy, że rysujesz jeden dach
    const feature = data.features[0];
    if (!feature || feature.geometry.type !== "Polygon") {
      onPolygonAreaChange?.({ areaM2: null, geojson: data });
      return;
    }

    const areaM2 = turfArea(feature as any); // m²
    onPolygonAreaChange?.({ areaM2, geojson: data });
  }, [onPolygonAreaChange]);

  const handleLoad = React.useCallback(() => {
    const mapboxMap = mapRef.current?.getMap();
    if (!mapboxMap) return;

    // ---- ESRI World Imagery jako tło raster + etykiety z streets-v12 ----
    if (!mapboxMap.getSource("esri-imagery")) {
      mapboxMap.addSource("esri-imagery", {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution:
          'Tiles © <a href="https://www.arcgis.com/home/item.html?id=974d45be315c4c87b2ac32be59af9a0b" target="_blank">Esri World Imagery</a>',
      } as any);
    }

    const style = mapboxMap.getStyle();
    const firstSymbolLayerId = style?.layers?.find(
      (l: any) => l.type === "symbol"
    )?.id;

    if (!mapboxMap.getLayer("esri-imagery-layer")) {
      mapboxMap.addLayer(
        {
          id: "esri-imagery-layer",
          type: "raster",
          source: "esri-imagery",
          paint: {
            "raster-opacity": 1,
          },
        } as any,
        firstSymbolLayerId
      );
    }

    // ---- Mapbox Draw: rysowanie poligonu dachu ----
    if (enableDrawPolygon && !drawRef.current) {

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: "draw_polygon",

        // ✅ TU ZMIENIASZ KOLORY ZAZNACZENIA
        styles: [
          // POLYGON fill (nieaktywny)
          {
            id: "gl-draw-polygon-fill-inactive",
            type: "fill",
            filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "false"]],
            paint: {
              "fill-color": "#7C3AED",   // fiolet
              "fill-opacity": 0.28,
              "fill-outline-color": "#6D28D9",
            },
          },
          // POLYGON fill (aktywny, podczas rysowania/edycji)
          {
            id: "gl-draw-polygon-fill-active",
            type: "fill",
            filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
            paint: {
              "fill-color": "#8B5CF6",   // jaśniejszy fiolet
              "fill-opacity": 0.26,
              "fill-outline-color": "#6D28D9",
            },
          },
          // POLYGON outline (nieaktywny)
          {
            id: "gl-draw-polygon-stroke-inactive",
            type: "line",
            filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "false"]],
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#6D28D9",
              "line-width": 2,
              "line-dasharray": [4, 3], // kreski
            },
          },

          // POLYGON outline (aktywny)
          {
            id: "gl-draw-polygon-stroke-active",
            type: "line",
            filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#5B21B6",
              "line-width": 2,
              "line-dasharray": [1.5, 1.5], // ciaśniejsze kreski gdy aktywny
            },
          },
          // Linie pomocnicze podczas rysowania
          {
            id: "gl-draw-line-active",
            type: "line",
            filter: ["all", ["==", "$type", "LineString"], ["==", "active", "true"]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#6D28D9",
              "line-width": 2,
              "line-dasharray": [3, 2],
            },
          },
          {
            id: "gl-draw-line-inactive",
            type: "line",
            filter: ["all", ["==", "$type", "LineString"], ["==", "active", "false"]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#6D28D9",
              "line-width": 2,
              "line-dasharray": [3, 2],
            },
          },
          // Vertexy (punkty)
          {
            id: "gl-draw-polygon-and-line-vertex-inactive",
            type: "circle",
            filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["==", "active", "false"]],
            paint: {
              "circle-radius": 3,
              "circle-color": "#FFFFFF",
              "circle-stroke-color": "#6D28D9",
              "circle-stroke-width": 2,
            },
          },
          {
            id: "gl-draw-polygon-and-line-vertex-active",
            type: "circle",
            filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["==", "active", "true"]],
            paint: {
              "circle-radius": 4,
              "circle-color": "#6D28D9",
              "circle-stroke-color": "#FFFFFF",
              "circle-stroke-width": 2,
            },
          },
        ],
      });


      drawRef.current = draw;
      mapboxMap.addControl(draw, "top-right");

      // reagujemy na zmiany geometrii
      mapboxMap.on("draw.create", handleDrawChange as any);
      mapboxMap.on("draw.update", handleDrawChange as any);
      mapboxMap.on("draw.delete", handleDrawChange as any);
    }
  }, [enableDrawPolygon, handleDrawChange]);

  return (
    <Map
      ref={mapRef}
      onLoad={handleLoad}
      initialViewState={{ latitude: lat, longitude: lon, zoom }}
      style={{ width: "100%", height: "100%", ...style }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      mapboxAccessToken={MAPBOX_TOKEN}
      preserveDrawingBuffer={forPrint}
      interactive={interactive}
      dragPan={interactive}
      scrollZoom={interactive}
      dragRotate={interactive}
      doubleClickZoom={interactive}
      touchZoomRotate={interactive}
      onMoveEnd={() => {
        if (!interactive) return;
        const z = mapRef.current?.getMap()?.getZoom();
        if (typeof z === "number" && Number.isFinite(z)) {
          onZoomChange?.(z);
        }
      }}
    >
      <Marker
        latitude={markerPos.lat}
        longitude={markerPos.lon}
        draggable={draggableMarker}
        onDragEnd={(e) => {
          // react-map-gl różnie opakowuje event – bierzemy lngLat jak jest
          const ev: any = e;
          const lngLat = ev.lngLat || ev.target?.getLngLat?.();
          if (!lngLat) return;

          const newLat = lngLat.lat;
          const newLon = lngLat.lng;

          setMarkerPos({ lat: newLat, lon: newLon });
          onMarkerChange?.({ lat: newLat, lon: newLon });
        }}
      />
    </Map>
  );
}

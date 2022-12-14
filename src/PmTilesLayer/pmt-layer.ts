// Copyright (c) 2020 Urban Computing Foundation

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// adapted from
// https://github.com/visgl/deck.gl/blob/master/modules/geo-layers/src/mvt-layer/mvt-layer.ts
// @ts-nocheck
import {
  Layer,
  LayersList,
  log,
  PickingInfo,
  UpdateParameters,
  GetPickingInfoParams,
  Viewport,
  COORDINATE_SYSTEM,
  DefaultProps,
} from "@deck.gl/core/typed";
import { GeoJsonLayer, GeoJsonLayerProps } from "@deck.gl/layers/typed";
import { Matrix4 } from "@math.gl/core";
import { binaryToGeojson } from "@loaders.gl/gis";
import { ClipExtension } from "@deck.gl/extensions/typed";
// import { GeojsonGeometryInfo } from "@loaders.gl/schema";
import { MVTWorkerLoader } from "@loaders.gl/mvt";
import { MVTLoader } from "@loaders.gl/mvt";
import type { Loader } from "@loaders.gl/loader-utils";
import type { BinaryFeatures } from "@loaders.gl/schema";
import type { Feature } from "geojson";

import TileLayer, {
  TiledPickingInfo,
  TileLayerProps,
} from "../tile-layer/tile-layer";
import Tileset2D, { Tileset2DProps } from "../tile-layer/tileset-2d";
import {
  // getURLFromTemplate,
  isGeoBoundingBox,
  // isURLTemplate,
} from "../tile-layer/utils";
import { GeoBoundingBox, TileLoadProps } from "../tile-layer/types";
import Tile2DHeader from "../tile-layer/tile-2d-header";
import { transform } from "./coordinate-transform";
import findIndexBinary from "./find-index-binary";
import { PMTiles } from "pmtiles";
// import Protobuf from "pbf";
// import { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
import { decompressSync } from "fflate";

const WORLD_SIZE = 512;

const defaultProps: DefaultProps<PmTilesLayerProps> = {
  ...GeoJsonLayer.defaultProps,
  onDataLoad: { type: "function", value: null, optional: true, compare: false },
  uniqueIdProperty: "",
  highlightedFeatureId: null,
  loaders: [MVTWorkerLoader],
  binary: true,
};

export type TileJson = {
  tilejson: string;
  tiles: string[];
  // eslint-disable-next-line camelcase
  vector_layers: any[];
  attribution?: string;
  scheme?: string;
  maxzoom?: number;
  minzoom?: number;
  version?: string;
};

type ParsedPmTile = Feature[] | BinaryFeatures;

/** All props supported by the PmTilesLayer */
export type PmTilesLayerProps<DataT extends Feature = Feature> =
  _PmTilesLayerProps & GeoJsonLayerProps<DataT> & TileLayerProps<ParsedPmTile>;

/** Props added by the PmTilesLayer  */
export type _PmTilesLayerProps = {
  /** Called if `data` is a TileJSON URL when it is successfully fetched. */
  onDataLoad?: ((tilejson: TileJson | null) => void) | null;

  /** Needed for highlighting a feature split across two or more tiles. */
  uniqueIdProperty?: string;

  /** A feature with ID corresponding to the supplied value will be highlighted. */
  highlightedFeatureId?: string | null;

  /**
   * Use tile data in binary format.
   *
   * @default true
   */
  binary?: boolean;

  /**
   * Loaders used to transform tiles into `data` property passed to `renderSubLayers`.
   *
   * @default [PmTilesWorkerLoader] from `@loaders.gl/mvt`
   */
  loaders?: Loader[];
};

type ContentWGS84Cache = { _contentWGS84?: Feature[] };

/** Render data formatted as [Mapbox Vector Tiles](https://docs.mapbox.com/vector-tiles/specification/). */
export default class PmTilesLayer<
  DataT extends Feature = Feature,
  ExtraProps = {}
> extends TileLayer<ParsedPmTile, Required<_PmTilesLayerProps> & ExtraProps> {
  static layerName = "PmTilesLayer";
  static defaultProps = defaultProps;

  initializeState(): void {
    super.initializeState();
    this.cache = new Map<string, PMTiles>();
    this.PMTiles = new PMTiles(this.props.data);
    // GlobeView doesn't work well with binary data
    const binary =
      this.context.viewport.resolution !== undefined
        ? false
        : this.props.binary;
    this.setState({
      binary: binary,
      data: null,
      tileJSON: null,
      pmtilesUrl: this.props.pmtilesUrl,
    });
  }

  get isLoaded(): boolean {
    return (
      this.state && this.state.data && this.state.tileset && super.isLoaded
    );
  }

  updateState({
    props,
    oldProps,
    context,
    changeFlags,
  }: UpdateParameters<this>) {
    if (changeFlags.dataChanged) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this._updateTileData();
    }

    if (this.state?.data) {
      super.updateState({ props, oldProps, context, changeFlags });
      this._setWGS84PropertyForTiles();
    }
    const { highlightColor } = props;
    if (
      highlightColor !== oldProps.highlightColor &&
      Array.isArray(highlightColor)
    ) {
      this.setState({ highlightColor });
    }
  }

  /* eslint-disable complexity */
  private async _updateTileData(): Promise<void> {
    let data: any = this.props.data;
    let tileJSON: any = null;
    this.PMTiles = new PMTiles(data);
    this.setState({ data, tileJSON });
  }

  _getTilesetOptions(): Tileset2DProps {
    const opts = super._getTilesetOptions();
    const tileJSON: TileJson | null | undefined = this.state.tileJSON;
    const { minZoom, maxZoom } = this.props;

    if (tileJSON) {
      if (
        Number.isFinite(tileJSON.minzoom) &&
        (tileJSON.minzoom as number) > (minZoom as number)
      ) {
        opts.minZoom = tileJSON.minzoom as number;
      }

      if (
        Number.isFinite(tileJSON.maxzoom) &&
        (!Number.isFinite(maxZoom) ||
          (tileJSON.maxzoom as number) < (maxZoom as number))
      ) {
        opts.maxZoom = tileJSON.maxzoom as number;
      }
    }
    return opts;
  }

  /* eslint-disable complexity */

  renderLayers(): Layer | null | LayersList {
    if (!this.state?.data) return null;
    return super.renderLayers();
  }
  getTileData(loadProps: TileLoadProps): Promise<ParsedPmTile> {
    // in future, binary vs geojson output like mvt
    // const { pmtilesUrl, binary } = this.state;
    const { index } = loadProps;
    if (!index) return Promise.reject(new Error("No index"));
    const { x, y, z } = index;
    // for caching?
    // const hash = `${data}/${z}/${x}/${y}`;
    // adapted from https://github.com/protomaps/PMTiles
    // Copyright 2021 Protomaps LLC
    // BSD 3-Clause "New" or "Revised" License
    return this.PMTiles.getZxy(z, x, y)
      .then((val) =>
        val 
          ? this.PMTiles!.source.getBytes(val.offset, val.length) 
          : null
      )
      .then((arr) => 
        arr 
          ? ParsePmTiles(arr, x, y, z) 
          : null
      );
  }

  renderSubLayers(
    props: TileLayer["props"] & {
      id: string;
      data: ParsedPmTile;
      _offset: number;
      tile: Tile2DHeader<ParsedPmTile>;
    }
  ): Layer | null | LayersList {
    const { x, y, z } = props.tile.index;
    const bbox = props?.tile?.bbox;
    const { east, west, north, south } = bbox || {};
    const worldScale = Math.pow(2, z);

    const xScale = WORLD_SIZE / worldScale;
    const yScale = -xScale;

    const xOffset = (WORLD_SIZE * x) / worldScale;
    const yOffset = WORLD_SIZE * (1 - y / worldScale);

    const modelMatrix = new Matrix4().scale([xScale, yScale, 1]);

    props.autoHighlight = false;

    if (!this.context.viewport.resolution) {
      props.modelMatrix = modelMatrix;
      props.coordinateOrigin = [xOffset, yOffset, 0];
      props.coordinateSystem = COORDINATE_SYSTEM.CARTESIAN;
      props.extensions = [...(props.extensions || []), new ClipExtension()];
      props.clipBounds = [west, south, east, north];
    }

    const subLayers = super.renderSubLayers(props);

    if (this.state.binary && !(subLayers instanceof GeoJsonLayer)) {
      log.warn(
        "renderSubLayers() must return GeoJsonLayer when using binary:true"
      )();
    }

    return subLayers;
  }

  protected _updateAutoHighlight(info: PickingInfo): void {
    const { uniqueIdProperty } = this.props;

    const { hoveredFeatureId, hoveredFeatureLayerName } = this.state;
    const hoveredFeature = info.object;
    let newHoveredFeatureId;
    let newHoveredFeatureLayerName;

    if (hoveredFeature) {
      newHoveredFeatureId = getFeatureUniqueId(
        hoveredFeature,
        uniqueIdProperty
      );
      newHoveredFeatureLayerName = getFeatureLayerName(hoveredFeature);
    }
    let { highlightColor } = this.props;
    if (typeof highlightColor === "function") {
      highlightColor = highlightColor(info);
    }

    if (
      hoveredFeatureId !== newHoveredFeatureId ||
      hoveredFeatureLayerName !== newHoveredFeatureLayerName
    ) {
      this.setState({
        highlightColor,
        hoveredFeatureId: newHoveredFeatureId,
        hoveredFeatureLayerName: newHoveredFeatureLayerName,
      });
    }
  }

  getPickingInfo(params: GetPickingInfoParams): TiledPickingInfo {
    const info = super.getPickingInfo(params);

    const isWGS84 = Boolean(this.context.viewport.resolution);

    if (this.state.binary && info.index !== -1) {
      const { data } = params.sourceLayer!.props;
      info.object = binaryToGeojson(data as BinaryFeatures, {
        globalFeatureId: info.index,
      }) as DataT;
    }
    if (info.object && !isWGS84) {
      info.object = transformTileCoordsToWGS84(
        info.object,
        info.tile!.bbox as GeoBoundingBox,
        this.context.viewport
      );
    }

    return info;
  }

  getSubLayerPropsByTile(
    tile: Tile2DHeader<ParsedPmTile>
  ): Record<string, any> {
    return {
      highlightedObjectIndex: this.getHighlightedObjectIndex(tile),
      highlightColor: this.state.highlightColor,
    };
  }

  private getHighlightedObjectIndex(tile: Tile2DHeader<ParsedPmTile>): number {
    const { hoveredFeatureId, hoveredFeatureLayerName, binary } = this.state;
    const { uniqueIdProperty, highlightedFeatureId } = this.props;
    const data = tile.content;

    const isHighlighted = isFeatureIdDefined(highlightedFeatureId);
    const isFeatureIdPresent =
      isFeatureIdDefined(hoveredFeatureId) || isHighlighted;

    if (!isFeatureIdPresent) {
      return -1;
    }

    const featureIdToHighlight = isHighlighted
      ? highlightedFeatureId
      : hoveredFeatureId;

    // Iterable data
    if (Array.isArray(data)) {
      return data.findIndex((feature) => {
        const isMatchingId =
          getFeatureUniqueId(feature, uniqueIdProperty) ===
          featureIdToHighlight;
        const isMatchingLayer =
          isHighlighted ||
          getFeatureLayerName(feature) === hoveredFeatureLayerName;
        return isMatchingId && isMatchingLayer;
      });

      // Non-iterable data
    } else if (data && binary) {
      // Get the feature index of the selected item to highlight
      return findIndexBinary(
        data,
        uniqueIdProperty,
        featureIdToHighlight,
        isHighlighted ? "" : hoveredFeatureLayerName
      );
    }

    return -1;
  }

  private _pickObjects(maxObjects: number | null): PickingInfo[] {
    const { deck, viewport } = this.context;
    const width = viewport.width;
    const height = viewport.height;
    const x = viewport.x;
    const y = viewport.y;
    const layerIds = [this.id];
    return deck!.pickObjects({ x, y, width, height, layerIds, maxObjects });
  }

  /** Get the rendered features in the current viewport. */
  getRenderedFeatures(maxFeatures: number | null = null): DataT[] {
    const features = this._pickObjects(maxFeatures);
    const featureCache = new Set();
    const renderedFeatures: DataT[] = [];

    for (const f of features) {
      const featureId = getFeatureUniqueId(
        f.object,
        this.props.uniqueIdProperty
      );

      if (featureId === undefined) {
        // we have no id for the feature, we just add to the list
        renderedFeatures.push(f.object as DataT);
      } else if (!featureCache.has(featureId)) {
        // Add removing duplicates
        featureCache.add(featureId);
        renderedFeatures.push(f.object as DataT);
      }
    }

    return renderedFeatures;
  }

  private _setWGS84PropertyForTiles(): void {
    const propName = "dataInWGS84";
    const tileset: Tileset2D = this.state.tileset;

    // @ts-expect-error selectedTiles are always initialized when tile is being processed
    tileset.selectedTiles.forEach((tile: Tile2DHeader & ContentWGS84Cache) => {
      if (!tile.hasOwnProperty(propName)) {
        // eslint-disable-next-line accessor-pairs
        Object.defineProperty(tile, propName, {
          get: () => {
            // Still loading or encountered an error
            if (!tile.content) {
              return null;
            }

            if (
              this.state.binary &&
              Array.isArray(tile.content) &&
              !tile.content.length
            ) {
              // https://github.com/visgl/loaders.gl/pull/1137
              return [];
            }

            const { bbox } = tile;
            if (tile._contentWGS84 === undefined && isGeoBoundingBox(bbox)) {
              // Create a cache to transform only once

              const content = this.state.binary
                ? binaryToGeojson(tile.content)
                : tile.content;
              tile._contentWGS84 = content.map((feature) =>
                transformTileCoordsToWGS84(feature, bbox, this.context.viewport)
              );
            }
            return tile._contentWGS84;
          },
        });
      }
    });
  }
}

function getFeatureUniqueId(
  feature: Feature,
  uniqueIdProperty: string | undefined
) {
  if (feature.properties && uniqueIdProperty) {
    return feature.properties[uniqueIdProperty];
  }

  if ("id" in feature) {
    return feature.id;
  }

  return undefined;
}

function getFeatureLayerName(feature: Feature): string | null {
  return feature.properties?.layerName || null;
}

function isFeatureIdDefined(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function transformTileCoordsToWGS84(
  object: Feature,
  bbox: GeoBoundingBox,
  viewport: Viewport
): Feature {
  const feature = {
    ...object,
    geometry: {
      type: object.geometry.type,
    },
  };

  // eslint-disable-next-line accessor-pairs
  Object.defineProperty(feature.geometry, "coordinates", {
    get: () => {
      const wgs84Geom = transform(object.geometry, bbox, viewport);
      return wgs84Geom.coordinates;
    },
  });

  return feature as Feature;
}

async function ParsePmTiles(
  arr: ArrayBuffer,
  x: number,
  y: number,
  z: number
): ParsedPmTile {
  let data = new Uint8Array(arr.buffer);
  if (data[0] === 0x1f && data[1] === 0x8b) {
    data = decompressSync(data);
  }
  let view = new DataView(data.buffer);
  const features = await MVTLoader.parse(
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    {
      mvt: {
        shape: "binary",
        coordinates: "wgs84",
        layerProperty: "layerName",
        layers: undefined,
        tileIndex: { x, y, z },
      },
    }
  );
  return features;
}

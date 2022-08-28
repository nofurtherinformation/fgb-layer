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
import { GeojsonGeometryInfo } from "@loaders.gl/schema";
import { MVTWorkerLoader } from "@loaders.gl/mvt";

import type { Loader } from "@loaders.gl/loader-utils";
import type { BinaryFeatures } from "@loaders.gl/schema";
import type { Feature } from "geojson";

import TileLayer, {
  TiledPickingInfo,
  TileLayerProps,
} from "../tile-layer/tile-layer";
import Tileset2D, { Tileset2DProps } from "../tile-layer/tileset-2d";
import {
  getURLFromTemplate,
  isGeoBoundingBox,
  isURLTemplate,
} from "../tile-layer/utils";
import { GeoBoundingBox, TileLoadProps } from "../tile-layer/types";
import Tile2DHeader from "../tile-layer/tile-2d-header";
import { transform } from "./coordinate-transform";
import findIndexBinary from "./find-index-binary";
import { PMTiles } from "pmtiles";
import Protobuf from "pbf";
import { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
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
      binary: false,
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
    const { pmtilesUrl, binary } = this.state;
    const { index, signal } = loadProps;
    if (!index) return Promise.reject(new Error("No index"));
    const { x, y, z } = index;

    const getData = async () => {
      const val = await this.PMTiles.getZxy(+z, +x, +y);
      if (!val) return null;
      const arr = await this.PMTiles!.source.getBytes(val.offset, val.length);
      let data = new Uint8Array(arr.buffer);
      if (data[0] == 0x1f && data[1] == 0x8b) {
        data = decompressSync(data);
      }
      let view = new DataView(data.buffer);

      let tile = new VectorTile(
        new Protobuf(
          new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        )
      );
      let features: Feature[] = [];
      for (let [name, layer] of Object.entries(tile.layers)) {
        for (var i = 0; i < layer.length; i++) {
          let feature = layer.feature(i);
          let geom = feature.loadGeometry().map(o => o.map(g => Object.values(g)));
          let tempFeature = {
            id: feature.id,
            properties: feature.properties,
            layerName: name,
            type: "Feature",
          }
          if (geom.length > 0) {
            switch (feature.type) {
              case 1: // Point
                tempFeature.geometry = {type: 'Point', coordinates: geom};
                break;
        
              case 2: // LineString
                tempFeature.geometry = {type: 'LineString', coordinates: geom};
                break;
        
              case 3: // Polygon
                tempFeature.geometry = {type: 'Polygon', coordinates: geom};
                break;
              default:
                throw new Error(`Invalid geometry type: ${this.type}`);
            }
            features.push(tempFeature);
          }
        }
        return features;
      }
    };
    return getData();
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
      // props.extensions = [...(props.extensions || []), new ClipExtension()];
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

export function getPmtilesUrlFromTemplate(
  template: string | string[],
  tile: {
    index: TileIndex;
    id: string;
  }
): string | null {
  if (!template || !template.length) {
    return null;
  }
  const { index, id } = tile;

  if (Array.isArray(template)) {
    const i = stringHash(id) % template.length;
    template = template[i];
  }

  let url = template;
  for (const key of Object.keys(index)) {
    const regex = new RegExp(`{${key}}`, "g");
    url = url.replace(regex, String(index[key]));
  }

  // Back-compatible support for {-y}
  if (Number.isInteger(index.y) && Number.isInteger(index.z)) {
    url = url.replace(/\{-y\}/g, String(Math.pow(2, index.z) - index.y - 1));
  }
  return url;
}

function parseToGeojson(
  arrayBuffer: ArrayBuffer,
  options: MVTOptions
): Feature[] {
  if (arrayBuffer.byteLength <= 0) {
    return [];
  }

  const features: MVTMapboxCoordinates[] = [];
  const tile = new VectorTile(new Protobuf(arrayBuffer));

  const selectedLayers = Array.isArray(options.layers)
    ? options.layers
    : Object.keys(tile.layers);

  selectedLayers.forEach((layerName: string) => {
    const vectorTileLayer = tile.layers[layerName];
    if (!vectorTileLayer) {
      return;
    }

    for (let i = 0; i < vectorTileLayer.length; i++) {
      const vectorTileFeature = vectorTileLayer.feature(i);
      const decodedFeature = getDecodedFeature(
        vectorTileFeature,
        options,
        layerName
      );
      features.push(decodedFeature);
    }
  });

  return features as Feature[];
}

/**
 * @param feature
 * @param options
 * @returns decoded feature
 */
function getDecodedFeature(
  feature: VectorTileFeatureMapBox,
  options: MVTOptions,
  layerName: string
): MVTMapboxCoordinates {
  const decodedFeature = feature.toGeoJSON(
    options.coordinates === "wgs84"
      ? options.tileIndex
      : transformToLocalCoordinates
  );

  // Add layer name to GeoJSON properties
  if (options.layerProperty) {
    decodedFeature.properties[options.layerProperty] = layerName;
  }

  return decodedFeature;
}

/**
 * @param line
 * @param feature
 */
function transformToLocalCoordinates(
  line: number[],
  feature: { extent: any }
): void {
  // This function transforms local coordinates in a
  // [0 - bufferSize, this.extent + bufferSize] range to a
  // [0 - (bufferSize / this.extent), 1 + (bufferSize / this.extent)] range.
  // The resulting extent would be 1.
  const { extent } = feature;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    p[0] /= extent;
    p[1] /= extent;
  }
}

function transformToLocalCoordinatesBinary(
  data: number[],
  feature: { extent: any }
) {
  // For the binary code path, the feature data is just
  // one big flat array, so we just divide each value
  const { extent } = feature;
  for (let i = 0, il = data.length; i < il; ++i) {
    data[i] /= extent;
  }
}

function parseToBinary(
  arrayBuffer: ArrayBuffer,
  options: MVTOptions
): BinaryFeatures {
  const [flatGeoJsonFeatures, geometryInfo] = parseToFlatGeoJson(
    arrayBuffer,
    options
  );

  const binaryData = flatGeojsonToBinary(flatGeoJsonFeatures, geometryInfo);
  // Add the original byteLength (as a reasonable approximation of the size of the binary data)
  // TODO decide where to store extra fields like byteLength (header etc) and document
  // @ts-ignore
  binaryData.byteLength = arrayBuffer.byteLength;
  return binaryData;
}

function parseToFlatGeoJson(
  arrayBuffer: ArrayBuffer,
  options: MVTOptions
): [FlatFeature[], GeojsonGeometryInfo] {
  const features: FlatFeature[] = [];
  const geometryInfo: GeojsonGeometryInfo = {
    coordLength: 2,
    pointPositionsCount: 0,
    pointFeaturesCount: 0,
    linePositionsCount: 0,
    linePathsCount: 0,
    lineFeaturesCount: 0,
    polygonPositionsCount: 0,
    polygonObjectsCount: 0,
    polygonRingsCount: 0,
    polygonFeaturesCount: 0,
  };

  if (arrayBuffer.byteLength <= 0) {
    return [features, geometryInfo];
  }

  const tile = new BinaryVectorTile(new Protobuf(arrayBuffer));

  const selectedLayers =
    options && Array.isArray(options.layers)
      ? options.layers
      : Object.keys(tile.layers);

  selectedLayers.forEach((layerName: string) => {
    const vectorTileLayer = tile.layers[layerName];
    if (!vectorTileLayer) {
      return;
    }

    for (let i = 0; i < vectorTileLayer.length; i++) {
      const vectorTileFeature = vectorTileLayer.feature(i, geometryInfo);
      const decodedFeature = getDecodedFeatureBinary(
        vectorTileFeature,
        options,
        layerName
      );
      features.push(decodedFeature);
    }
  });

  return [features, geometryInfo];
}

class BinaryVectorTile {
  layers: { [x: string]: VectorTileLayer };
  constructor(pbf: Protobuf, end?: number) {
    this.layers = pbf.readFields(readTile, {}, end);
  }
}

/**
 *
 * @param tag
 * @param layers
 * @param pbf
 */
function readTile(
  tag: number,
  layers?: { [x: string]: VectorTileLayer },
  pbf?: Protobuf
): void {
  if (tag === 3) {
    if (pbf) {
      const layer = new VectorTileLayer(pbf, pbf.readVarint() + pbf.pos);
      if (layer.length && layers) {
        layers[layer.name] = layer;
      }
    }
  }
}

class VectorTileLayer {
  version: number;
  name: string;
  extent: number;
  length: number;
  _pbf: Protobuf;
  _keys: string[];
  _values: (string | number | boolean | null)[];
  _features: number[];
  constructor(pbf: Protobuf, end: number) {
    // Public
    this.version = 1;
    this.name = "";
    this.extent = 4096;
    this.length = 0;

    // Private
    this._pbf = pbf;
    this._keys = [];
    this._values = [];
    this._features = [];

    pbf.readFields(readLayer, this, end);

    this.length = this._features.length;
  }

  /**
   * return feature `i` from this layer as a `VectorTileFeature`
   *
   * @param index
   * @param geometryInfo
   * @returns {VectorTileFeature}
   */
  feature(i: number, geometryInfo: GeojsonGeometryInfo): VectorTileFeature {
    if (i < 0 || i >= this._features.length) {
      throw new Error("feature index out of bounds");
    }

    this._pbf.pos = this._features[i];

    const end = this._pbf.readVarint() + this._pbf.pos;
    return new VectorTileFeature(
      this._pbf,
      end,
      this.extent,
      this._keys,
      this._values,
      geometryInfo
    );
  }
}

/**
 *
 * @param tag
 * @param layer
 * @param pbf
 */
function readLayer(tag: number, layer?: VectorTileLayer, pbf?: Protobuf): void {
  if (layer && pbf) {
    if (tag === 15) layer.version = pbf.readVarint();
    else if (tag === 1) layer.name = pbf.readString();
    else if (tag === 5) layer.extent = pbf.readVarint();
    else if (tag === 2) layer._features.push(pbf.pos);
    else if (tag === 3) layer._keys.push(pbf.readString());
    else if (tag === 4) layer._values.push(readValueMessage(pbf));
  }
}

/**
 *
 * @param pbf
 * @returns value
 */
function readValueMessage(pbf: Protobuf) {
  let value: string | number | boolean | null = null;
  const end = pbf.readVarint() + pbf.pos;

  while (pbf.pos < end) {
    const tag = pbf.readVarint() >> 3;

    value =
      tag === 1
        ? pbf.readString()
        : tag === 2
        ? pbf.readFloat()
        : tag === 3
        ? pbf.readDouble()
        : tag === 4
        ? pbf.readVarint64()
        : tag === 5
        ? pbf.readVarint()
        : tag === 6
        ? pbf.readSVarint()
        : tag === 7
        ? pbf.readBoolean()
        : null;
  }

  return value;
}

/**
 * @param feature
 * @param options
 * @returns decoded binary feature
 */
function getDecodedFeatureBinary(
  feature: VectorTileFeatureBinary,
  options: MVTOptions,
  layerName: string
): FlatFeature {
  console.log(feature);
  const decodedFeature = feature.toBinaryCoordinates(
    options.coordinates === "wgs84"
      ? options.tileIndex
      : transformToLocalCoordinatesBinary
  );

  // Add layer name to GeoJSON properties
  if (options.layerProperty && decodedFeature.properties) {
    decodedFeature.properties[options.layerProperty] = layerName;
  }

  return decodedFeature;
}

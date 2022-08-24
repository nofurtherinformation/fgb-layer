import {
  CompositeLayer,
  CompositeLayerProps,
  Layer,
  LayerProps,
  UpdateParameters,
  PickingInfo,
  GetPickingInfoParams,
  DefaultProps,
  FilterContext,
  _flatten as flatten,
} from "@deck.gl/core/typed";
import { GeoJsonLayer } from "@deck.gl/layers/typed";
import { LayersList } from "@deck.gl/core/typed";
import { geojson as fgb } from "flatgeobuf";
const { deserialize } = fgb;
// //   import Tile2DHeader from './tile-2d-header';
// //   import Tileset2D, {RefinementStrategy, STRATEGY_DEFAULT, Tileset2DProps} from './tileset-2d';
// //   import {TileLoadProps, ZRange} from './types';
// //   import {urlType, getURLFromTemplate} from './utils';
export const urlType = {
  type: "url",
  value: null,
  validate: (value: string | null | any[], propType?: any) =>
    (propType.optional && value === null) ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((url) => typeof url === "string")),
  //  @ts-ignore
  equals: (value1, value2) => {
    if (value1 === value2) {
      return true;
    }
    if (!Array.isArray(value1) || !Array.isArray(value2)) {
      return false;
    }
    const len = value1.length;
    if (len !== value2.length) {
      return false;
    }
    for (let i = 0; i < len; i++) {
      if (value1[i] !== value2[i]) {
        return false;
      }
    }
    return true;
  },
};

const defaultProps: DefaultProps<FgbLayerProps> = {
  //   TilesetClass: Tileset2D,
  data: { type: "data", value: [] },
  dataComparator: urlType.equals,
  renderSubLayers: {
    type: "function",
    value: (props: any) => new GeoJsonLayer(props),
    compare: false,
  },
  getFgbData: {
    type: "function",
    optional: true,
    value: null,
    compare: false,
  },
  onFgbLoad: { type: "function", value: (data: any) => {}, compare: false },
  //   onTileUnload: { type: "function", value: (tile) => {}, compare: false },
  // eslint-disable-next-line
  onFgbError: {
    type: "function",
    value: (err: any) => console.error(err),
    compare: false,
  },
  extent: { type: "array", optional: true, value: null, compare: true },
  //   tileSize: 512,
  maxZoom: null,
  minZoom: 0,
  //   maxCacheSize: null,
  //   maxCacheByteSize: null,
  //   refinementStrategy: STRATEGY_DEFAULT,
  zRange: null,
  //   maxRequests: 6,
  zoomOffset: 0,
};

// types
export type ZRange = [minZ: number, maxZ: number];
export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];
export type FgbBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
export type GeoBoundingBox = {
  west: number;
  north: number;
  east: number;
  south: number;
};
export type NonGeoBoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type TileBoundingBox = NonGeoBoundingBox | GeoBoundingBox;
type FgbBoundingBox = NonGeoBoundingBox | GeoBoundingBox;
export type TileIndex = { x: number; y: number; z: number };
export type TileLoadProps = {
  index: TileIndex;
  id: string;
  bbox: TileBoundingBox;
  url?: string | null;
  signal?: AbortSignal;
  userData?: Record<string, any>;
  zoom?: number;
};
export type FgbLoadProps = {
  id: string;
  bbox: FgbBoundingBox;
  url?: string | null;
  signal?: AbortSignal;
  userData?: Record<string, any>;
  zoom?: number;
};

export type Tileset2DProps = Pick<
  Required<FgbLayerProps>,
  "extent" | "maxZoom" | "minZoom" | "zoomOffset"
> & {
  getFgbData: NonNullable<FgbLayerProps["getFgbData"]>;
  onFgbLoad: (data: any) => void;
  onFgbError: (error: any, data: any) => void;
};
export type FgbPickingInfo<DataT = any> = PickingInfo & {
  data?: DataT;
};

/** All props supported by the FlatGeoBufLayer */
export type FgbLayerProps<DataT = any> = CompositeLayerProps<any> &
  _FgbLayerProps<DataT>;

/** Props added by the FlatGeoBufLayer */
type _FgbLayerProps<DataT> = {
  /**
   * Renders one or an array of Layer instances.
   */
  renderSubLayers?: (
    props: FgbLayerProps<DataT> & {
      id: string;
      data: DataT;
      _offset: number;
    }
  ) => Layer | null | LayersList;
  /**
   * If supplied, `getTileData` is called to retrieve the data of each tile.
   */
  getFgbData?:
    | ((
        path: string,
        bounds: {
          minX: number;
          minY: number;
          maxX: number;
          maxY: number;
        }
      ) => Promise<DataT> | DataT)
    | null;

  /** Called when a fgb bound successfully loads. */
  onFgbLoad?: (data: DataT) => void;

  /** Called when an fgb failed to load. */
  onFgbError?: (err: any) => void;

  /** The bounding box of the layer's data. */
  extent?: number[] | null;

  /** The max zoom level of the layer's data.
   * @default null
   */
  maxZoom?: number | null;

  /** The min zoom level of the layer's data.
   * @default 0
   */
  minZoom?: number | null;

  /** Range of minimum and maximum heights in the tile. */
  zRange?: ZRange | null;

  /**
   * This offset changes the zoom level at which the tiles are fetched.
   *
   * Needs to be an integer.
   *
   * @default 0
   */
  zoomOffset?: number;
};

/**
 * The Flatgeobuf is a composite layer that makes it possible to visualize very large datasets.
 *
 * Instead of fetching the entire dataset, it only loads and renders what's visible in the current viewport.
 */
export default class FlatGeobufLayer<
  DataT = any,
  ExtraPropsT = {}
> extends CompositeLayer<ExtraPropsT & Required<_FgbLayerProps<DataT>>> {
  static defaultProps = defaultProps as any;
  static layerName = "FgbLayer";

  initializeState() {
    // @ts-ignore
    this.state = {
        loadedBounds: "",
      renderedBounds: "",
      isLoaded: false,
      geojsonData: {
        "type": "FeatureCollection",
        "features": []
      },
      maxFeatures: 10000
    };
  }

  finalizeState() {
    // this.state?.tileset?.finalize();
  }

  get isLoaded(): boolean {
    // @ts-ignore
    return this.state?.loadedViewport === this.context?.viewport;
  }

  // @ts-ignore
  shouldUpdateState({ changeFlags }): boolean {
    return changeFlags.somethingChanged;
  }

  updateState({ changeFlags }: UpdateParameters<this>) {
    // let { tileset } = this.state;
    // const propsChanged =
    //   changeFlags.propsOrDataChanged || changeFlags.updateTriggersChanged;
    // const dataChanged =
    //   changeFlags.dataChanged ||
    //   (changeFlags.updateTriggersChanged &&
    //     (changeFlags.updateTriggersChanged.all ||
    //       changeFlags.updateTriggersChanged.getFgbData));

    this._updateFgbData();
  }

  _getFgbOptions(): Tileset2DProps {
    const {
      extent,
      maxZoom,
      minZoom,
      zoomOffset,
      //   @ts-ignore
    } = this.props;

    return {
      maxZoom,
      minZoom,
      extent,
      zoomOffset,

      getFgbData: this.getFgbData.bind(this),
      onFgbLoad: this._onFgbLoad.bind(this),
      onFgbError: this._onFgbError.bind(this),
    };
  }

  private _updateFgbData(): void {
    const { loadedViewport } = this.state;
    const { data, zRange, getFgbData } = this.props;
    const { viewport } = this.context;
    // @ts-ignore
    if (loadedViewport !== JSON.stringify(viewport)) {
      // this.getFgbData(viewport);
      const [x1, y1] = viewport.unproject([0, 0]);
      const [x2, y2] = viewport.unproject([viewport.width, viewport.height]);

      const [minX, minY, maxX, maxY] = [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2),
      ];

      this.getFgbData(data as string, {
        minX,
        minY,
        maxY,
        maxX,
      });
    }
  }

  _onFgbLoad(data: DataT): void {
    this.props.onFgbLoad(data);
    this.setNeedsUpdate();
  }

  _onFgbError(error: any, data: DataT) {
    this.props.onFgbError(error);
    this.setNeedsUpdate();
  }

  // Methods for subclass to override
  async queryFgbFeatures(path: string, bounds: FgbBounds): Promise<any> {
    this.state.loadedBounds = JSON.stringify(bounds)
    let iter = deserialize(path, bounds);
    if (iter) {
        let features = []
        let count = 0;
        // @ts-ignore
        for await (let feature of iter) {
            features.push(feature)
            count++;
            if (count % 200 === 0) {
            this.state.geojsonData.features = features;
            this.renderLayers();
        }
    }
    this.state.geojsonData.features = features;
        this.renderLayers();
    }
  }
  getFgbData(
    path: string,
    bounds: {
      minX: number;
      maxY: number;
      minY: number;
      maxX: number;
    }
  ): Promise<DataT> | DataT | null {
    const { getFgbData } = this.props;
    // const { signal } = tile;

    if (getFgbData) {
      return getFgbData(path as string, bounds);
    } else {
      return this.queryFgbFeatures(path as string, bounds);
    }
  }

  renderSubLayers(
    // @ts-ignore
    props: FlatGeobufLayer["props"] & {
      id: string;
      data: DataT;
      _offset: number;
    }
  ): Layer | null | LayersList {
    // @ts-ignore
    return this.props.renderSubLayers(props);
  }

  getSubLayerPropsByTile(data: DataT): Partial<LayerProps> | null {
    return null;
  }

  getPickingInfo({
    info,
    sourceLayer,
  }: GetPickingInfoParams): FgbPickingInfo<DataT> {
    (info as any) = (sourceLayer as any).props;
    return info;
  }

  protected _updateAutoHighlight(info: PickingInfo): void {
    if (info.sourceLayer) {
      info.sourceLayer.updateAutoHighlight(info);
    }
  }

  renderLayers(): Layer | null | LayersList {
    // @ts-ignore
    const layers =  this.renderSubLayers({data: this.state.geojsonData})
    console.log(layers)
    return layers
  }
  filterSubLayer(){
    return true
  }
}

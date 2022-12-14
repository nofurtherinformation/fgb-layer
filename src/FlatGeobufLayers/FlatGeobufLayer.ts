import {
  CompositeLayer,
  CompositeLayerProps,
  Layer,
  UpdateParameters,
} from "@deck.gl/core/typed";
import { wrap } from "comlink";

const FgbWorker = wrap(new Worker(new URL("./fgbWorker", import.meta.url)));

class FlatGeobufLayer extends CompositeLayer {
  shouldUpdateState(
    params: UpdateParameters<Layer<Required<CompositeLayerProps<{
        fgbUrl: string;
        useBinaryGeojson: boolean;
        rendersubLayers: (data: any, viewport: any) => any;
    }>>>>
  ): boolean {
    return params.changeFlags.somethingChanged;
  }
  // @ts-ignore
  updateState({ props, changeFlags }) {
    if (changeFlags.viewportChanged) {
      const { fgbUrl } = props;
      // @ts-ignore
      clearTimeout(this.debounce);
      // @ts-ignore
      this.debounce = setTimeout(() => {
        this._updateFgbData(fgbUrl);
      }, 250)
    }
  }

  private _updateFgbData(path: string): void {
    console.log('fetching data')
    const { viewport } = this.context;

    // @ts-ignore
    // if (loadedViewport !== JSON.stringify(viewport)) {
    // this.setState({
    //   loadedBounds: JSON.stringify(viewport)
    // })
    // this.getFgbData(viewport);
    const [x1, y1] = viewport.unproject([0, 0]);
    const [x2, y2] = viewport.unproject([viewport.width, viewport.height]);

    const [minX, minY, maxX, maxY] = [
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.max(x1, x2),
      Math.max(y1, y2),
    ];

    this.getFgbData(path, {
      minX,
      minY,
      maxY,
      maxX,
    });
    // }
  }

  async getFgbData(
    path: string,
    bounds: {
      minX: number;
      maxY: number;
      minY: number;
      maxX: number;
    }
  ): Promise<any> {
      // @ts-ignore
      const { useBinaryGeojson } = this.props;
    // @ts-ignore
    const data = await FgbWorker.getFgbData(path, bounds, useBinaryGeojson);
    this.setState({data})
  }

  renderLayers() {
    // @ts-ignore
    const { renderSubLayers } = this.props;
    const { data } = this.state;
    return [
      renderSubLayers({
        data,
        viewport: this.context.viewport
      }),
    ];
  }
}

export default FlatGeobufLayer;

import {
    CompositeLayer,
    CompositeLayerProps,
    Layer,
    UpdateParameters,
  } from "@deck.gl/core/typed";
  // import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers/typed";
  import { wrap } from "comlink";
  import { ProtocolCache } from 'pmtiles'
  // @ts-ignore
  // import debounce from "lodash.debounce";
//   const FgbWorker = wrap(new Worker(new URL("./fgbWorker", import.meta.url)));
  // import BezierCurveLayer from './bezier-curve-layer/bezier-curve-layer';
  
  class PmTilesLayer extends CompositeLayer {
    instantiatePmTiles(){
        // @ts-ignore
        this.cache = new ProtocolCache()
    }
    shouldUpdateState(
      params: UpdateParameters<Layer<Required<CompositeLayerProps<{
          dataUrl: string;
          useBinaryGeojson: boolean;
          rendersubLayers: (data: any, viewport: any) => any;
      }>>>>
    ): boolean {
      return params.changeFlags.somethingChanged;
    }
    // @ts-ignore
    updateState({ props, changeFlags }) {
      if (changeFlags.viewportChanged) {
        const { dataUrl } = props;
        // @ts-ignore
        clearTimeout(this.debounce);
        // @ts-ignore
        this.debounce = setTimeout(() => {
          this._updateData(dataUrl);
        }, 250)
      }
    }
  
    private _updateData(path: string): void {
      const { viewport } = this.context;
      console.log(this)
        // @ts-ignore
      if (!this.cache){
        // this.instantiatePmTiles()
      }

    }
  
    async getData(
    ): Promise<any> {
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
  
  export default PmTilesLayer;
  
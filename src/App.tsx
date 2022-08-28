import React from 'react';
import DeckGL from '@deck.gl/react/typed';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers/typed';
import { TileLayer } from '@deck.gl/geo-layers/typed';
import FlatGeobufLayer from './FlatGeobufLayers/FlatGeobufLayer';
import {HexagonLayer} from '@deck.gl/aggregation-layers/typed';
import PmTilesLayer from './PmTilesLayer/pmt-layer';
import MVTLayer from './PmTilesLayer/mvt-layer';
const INITIAL_VIEW_STATE = {
  longitude: -122.41669,
  latitude: 37.7853,
  zoom: 11,
  pitch: 0,
  bearing: 0
}

export default function App() {
  // const [viewState, setViewState] = React.useState();

  const layers = [

    new TileLayer({
      // https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Tile_servers
      data: 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',

      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      // @ts-ignore
      renderSubLayers: props => {
        const {
          // @ts-ignore
          bbox: { west, south, east, north }
        } = props.tile;

        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north]
        });
      }
    }),
    // @ts-ignore
    // new MVTLayer({
    //   id: 'mvt',
    //   data: 'https://b.tiles.mapbox.com/v4/mapbox.mapbox-streets-v6/{z}/{x}/{y}.vector.pbf?access_token=pk.eyJ1IjoiZGhhbHBlcm4iLCJhIjoiY2p3MHFvZHg2MDcyczQ4bXBjNW85aDh2OCJ9.OUluk6vAGe5BVXLOiGIoQQ',
    //   getFillColor: [255, 0, 0],
    //   // @ts-ignore
    //   getElevation: f => f.properties.POP_EST / 1000000,
    //   getLineWidth: 1,
    //   pickable: true,
    //   opacity: 0.8,
    //   stroked: true,
    //   filled: true,
    //   wireframe: false,
    //   extruded: true,
    //   elevationScale: 5,
    //   fp64: false,
    //   getLineColor: [255, 0, 0],
    // }),
    // @ts-ignore/
    new PmTilesLayer({
      id: 'pmtiles-layer',
      data:`${process.env.PUBLIC_URL}/cb_2018_us_zcta510_500k_nolimit.pmtiles`,
      // @ts-ignore
    // @ts-ignore
      renderSubLayers: (props) => {
        console.log(props)
        return new GeoJsonLayer({
          id: 'geojson-layer' + props.id,
          // ...props
          // @ts-ignore
          data: {
            type: 'FeatureCollection',
            features: props?.data || []
          },
          getFillColor: [255, 0, 0],
          
        })
      }
    }),

    // new FlatGeobufLayer({
    //   // @ts-ignore
    //   fgbUrl: `${process.env.PUBLIC_URL}/cbg_centroids.fgb`,
    //   // minZoom: 15,
    //   // maxzoom: 22,
    //   // @ts-ignore
    //   renderSubLayers: ({data, viewport}) => {
    //     console.log(1/(viewport.scale-22) * 1e8)
    //     return new HexagonLayer({
    //       data,
    //       getPosition: feature => feature.geometry.coordinates,
    //       pickable: true,
    //       extruded: true,
    //       radius: 1/(viewport.scale-22) * 1e5,
    //       elevationScale: 4,
    //       id: "hexlayer"

    //     })
    //     // return new GeoJsonLayer({
    //     //   data: props.data,
    //     //   filled: false,
    //     //   getFillColor: [0, 0, 0],
    //     //   getLineColor: [255, 0, 0],
    //     //   lineWidthScale: 20,
    //     //   lineWidthMinPixels: 2,
    //     //   getLineWidth: 1,
    //     //   getPointRadius: 5,
    //     //   id: 'fgb-geojson'
    //     // })

    //   }
    // }),
  ]

  return <div style={{ width: '100%', height: '100%' }}>
    <DeckGL
    // @ts-ignore
      initialViewState={INITIAL_VIEW_STATE} controller={true} layers={layers} />
  </div>
}
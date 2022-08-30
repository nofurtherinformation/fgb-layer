import React from 'react'; // eslint-disable-line no-unused-vars
import DeckGL from '@deck.gl/react/typed';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers/typed';
import { TileLayer } from '@deck.gl/geo-layers/typed';
import PmTilesLayer from './PmTilesLayer/pmt-layer';
import FlatGeobufLayer from './FlatGeobufLayers/FlatGeobufLayer'; // eslint-disable-line @typescript-eslint/no-unused-vars
import MVTLayer from './PmTilesLayer/mvt-layer'; // eslint-disable-line @typescript-eslint/no-unused-vars

const INITIAL_VIEW_STATE = {
  longitude: -122.41669,
  latitude: 37.7853,
  zoom: 5,
  pitch: 0,
  bearing: 0
}

export default function App() {
  const layers = [
    new TileLayer({
      data: 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
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

    // // @ts-ignore
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
      data:`${process.env.PUBLIC_URL}/zip.pmtiles`,
      // @ts-ignore
      onClick: (info) => {
        console.log(info)
      },
      // @ts-ignore
      renderSubLayers: ({data, id, extensions, clipBounds}) => {
        return new GeoJsonLayer({
          id: 'geojson-layer' + id,
          // @ts-ignore
          data,
          // @ts-ignore
          getFillColor: f => [255, 0, 0, Math.max(50, Math.min(255, f.properties.AWATER10 / 50000))],
          pickable: true,
          clipBounds,
          extensions
        })
      }
    }),

    // new FlatGeobufLayer({
    //   // @ts-ignore
    //   fgbUrl: `${process.env.PUBLIC_URL}/cbg_centroids.fgb`,
    //   // @ts-ignore
    //   renderSubLayers: ({data, viewport}) => {
    //     return new GeoJsonLayer({
    //       data,
    //       filled: true,
    //       getFillColor: [255, 255, 0],
    //       pointRadiusMinPixels: 2,
    //       id: 'fgb-geojson'
    //     })

    //   }
    // }),
  ]

  return <div style={{ width: '100%', height: '100%' }}>
    <DeckGL
    // @ts-ignore
      initialViewState={INITIAL_VIEW_STATE} controller={true} layers={layers} />
  </div>
}
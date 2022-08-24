import React from 'react';
import DeckGL from '@deck.gl/react/typed';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers/typed';
import { TileLayer } from '@deck.gl/geo-layers/typed';
import { FlatGeobufLayer } from './FlatGeobufLayers';


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

    new FlatGeobufLayer({
      data: `${process.env.PUBLIC_URL}/cbg.fgb`,
      minZoom: 15,
      maxzoom: 22,
      renderSubLayers: props => {
        
        return new GeoJsonLayer({
          data: props.data,
          getFillColor: [0, 0, 0],
          getLineColor: [255, 255, 255],
          lineWidthScale: 20,
          lineWidthMinPixels: 2,
          getLineWidth: 1,
          id: 'fgb-geojson'
        })

      }
    }),
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
    })
  ]
  console.log('layers', layers)

  return <div style={{ width: '100%', height: '100%' }}>
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE} controller={true} layers={layers} />
  </div>
}
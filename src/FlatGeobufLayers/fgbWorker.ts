
import { expose } from 'comlink';
import { geojson as fgb } from "flatgeobuf";
import {geojsonToBinary} from '@loaders.gl/gis';
const { deserialize } = fgb;

class FgbWorker {
    constructor(){

    }
    async getFgbData(path: string, bounds: any){
        let iter = deserialize(path, bounds);
        let features = [];
        // @ts-ignore
        for await (let feature of iter) {
            features.push(feature);
        }
        return geojsonToBinary(features)
    }
}

expose(new FgbWorker())
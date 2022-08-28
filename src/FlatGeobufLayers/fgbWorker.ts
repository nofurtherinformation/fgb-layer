
import { expose } from 'comlink';
import { geojson as fgb } from "flatgeobuf";
import {geojsonToBinary} from '@loaders.gl/gis';
const { deserialize } = fgb;

class FgbWorker {
    // constructor(){

    // }
    async getFgbData(path: string, bounds: any, useBinaryGeojson: boolean = false): Promise<any> {
        let iter = deserialize(path, bounds);
        let features = [];
        // @ts-ignore
        for await (let feature of iter) {
            features.push(feature);
        }
        if (useBinaryGeojson) {
            return geojsonToBinary(features)
        } else {
            return features;
        }
    }
}

expose(new FgbWorker())
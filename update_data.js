#!/usr/local/bin/node
const overpass = require("./overpass");
const features = require("./features");
const writetiles = require("./writetiles");

// usage: node update_data.js [--bbox "minlat,minlon,maxlat,maxlon"] [--server <url>] [--out <dir>]
// default bbox: DACH region (Germany, Austria, Switzerland)
//
// Single-region convenience pipeline: fetch -> normalize -> tiles.
// For worldwide updates use fetch_regions.js + build_tiles.js (see AGENTS.md).

const DEFAULT_BBOX = "46.51351558059737,4.2626953125,55.26659815231191,17.7978515625";

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--bbox") opts.bbox = argv[++i];
        else if (argv[i] === "--server") opts.server = argv[++i];
        else if (argv[i] === "--out") opts.out = argv[++i];
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const bbox = opts.bbox || DEFAULT_BBOX;
    const outDir = opts.out || "data";
    const lastUpdate = writetiles.lastUpdateString();

    console.log(lastUpdate);
    console.log(`bbox: ${bbox}`);

    const geojson = await overpass.fetchFeatures(bbox, opts.server);
    const fetched = geojson.features ? geojson.features.filter((feature) => feature.geometry) : [];
    if (fetched.length === 0) {
        throw new Error(`Overpass returned no features — refusing to overwrite ${outDir}/ with an empty result`);
    }

    const normalized = features.normalizeFeatures(fetched);
    const stats = writetiles.writeTiles(outDir, normalized, lastUpdate);
    console.log(`${stats.features} features -> ${stats.tiles} tiles in ${outDir}/`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

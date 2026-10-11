#!/usr/local/bin/node
const fs = require("fs");
const overpass = require("./overpass");
const features = require("./features");

// usage: node fetch_regions.js --regions <regions.json> --out <dir>
//
// Fetches every region in the file (sequentially, politely), normalizes and
// merges the results, and writes <dir>/features.json (a GeoJSON
// FeatureCollection, deduplicated by OSM id). The CI matrix calls this once
// per chunk of regions; locally it can fetch the whole world at once.
//
// Each region uses the Overpass server assigned in regions.json; if that
// server fails, the other public servers are tried in turn.

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--regions") opts.regions = argv[++i];
        else if (argv[i] === "--out") opts.out = argv[++i];
    }
    if (!opts.regions || !opts.out) {
        console.error("usage: node fetch_regions.js --regions <regions.json> --out <dir>");
        process.exit(1);
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const regions = JSON.parse(fs.readFileSync(opts.regions, "utf8"));

    // server pool: the servers used in the regions file (production: the
    // public Overpass instances from regions.json)
    const pool = [...new Set(regions.map((region) => region.server))];

    const collections = [];
    for (const region of regions) {
        const bbox = region.bbox.join(",");
        let geojson = null;
        let lastError = null;

        // assigned server first, then the other servers from the pool
        const servers = [region.server, ...pool.filter((server) => server !== region.server)];
        for (const server of servers) {
            try {
                console.log(`[${region.name}] fetching via ${server}`);
                geojson = await overpass.fetchFeatures(bbox, server);
                break;
            } catch (error) {
                lastError = error;
                console.error(`[${region.name}] ${server} failed: ${error.message}`);
            }
        }
        if (!geojson) {
            throw new Error(`region ${region.name} failed on all servers (last error: ${lastError.message})`);
        }

        const normalized = features.normalizeFeatures(geojson.features || []);
        console.log(`[${region.name}] ${normalized.length} features`);
        collections.push({ type: "FeatureCollection", features: normalized });
    }

    const merged = features.mergeFeatures(collections);
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(`${opts.out}/features.json`, JSON.stringify(merged));
    console.log(`${merged.features.length} unique features -> ${opts.out}/features.json`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

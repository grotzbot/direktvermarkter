#!/usr/local/bin/node
const fs = require("fs");
const features = require("./features");
const writetiles = require("./writetiles");

// usage: node build_tiles.js --out <dir> <features.json> [more.json ...]
//
// Merges feature files (deduplicated by OSM id — region borders overlap),
// normalizes them and writes the full tiled layout into <dir> (wiping it
// first). The CI merge job calls this with one features.json per fetch chunk.

function parseArgs(argv) {
    const opts = { files: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--out") opts.out = argv[++i];
        else opts.files.push(argv[i]);
    }
    if (!opts.out || opts.files.length === 0) {
        console.error("usage: node build_tiles.js --out <dir> <features.json> [more.json ...]");
        process.exit(1);
    }
    return opts;
}

const opts = parseArgs(process.argv.slice(2));
const collections = opts.files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const merged = features.mergeFeatures(collections);
const normalized = features.normalizeFeatures(merged.features);
const lastUpdate = writetiles.lastUpdateString();
const stats = writetiles.writeTiles(opts.out, normalized, lastUpdate);
console.log(`${stats.features} features -> ${stats.tiles} tiles in ${opts.out}/`);

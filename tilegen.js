// Tiling for the farmshops.eu data pipeline.
//
// From a GeoJSON FeatureCollection of point features (as produced by update_data.js,
// each feature carrying its full OSM tags in `properties` plus the derived category
// `properties.p`), two tile schemes are generated:
//
// 1. Detail cells (data/tiles/detail/<y>/<x>.json): fixed 1°x1° cells, used by the
//    frontend at map zoom >= 7. Each cell holds the raw point features with their
//    full properties, so marker popups need no extra requests.
//
// 2. Cluster tiles (data/tiles/cluster/<z>/<x>/<y>.json): slippy-map tiles at zooms
//    0-6, used by the frontend at map zoom <= 6. Points inside a tile are binned into
//    a 4x4 grid (64px clusters on 256px tiles, like supercluster). Bins with more than
//    one point become a cluster feature (count + per-category counts + centroid),
//    single points keep their full properties so popups work at any zoom.
//
// Only non-empty tiles are emitted. Tiles are plain JSON (fetched on demand by the
// frontend), not JS.

const DETAIL_CELL_SIZE = 1; // degrees
const CLUSTER_MAX_ZOOM = 6;
const CLUSTER_BINS = 4; // 4x4 bins per tile = 64px clusters on 256px tiles
const TILE_SIZE = 256;
const MAX_LAT = 85.05112878; // slippy map limit

const CATEGORIES = ["farm", "marketplace", "vending_machine", "beekeeper", "unknown"];

function clampLat(lat) {
    return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
}

function lonToTileX(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}

function latToTileY(lat, z) {
    const rad = clampLat(lat) * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
}

// pixel position in the 256*2^z world (used for cluster binning)
function lonToPx(lon, z) {
    return (lon + 180) / 360 * TILE_SIZE * Math.pow(2, z);
}

function latToPx(lat, z) {
    const rad = clampLat(lat) * Math.PI / 180;
    const s = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
    return (1 - s / Math.PI) / 2 * TILE_SIZE * Math.pow(2, z);
}

function categoryOf(feature) {
    return CATEGORIES.includes(feature.properties.p) ? feature.properties.p : "unknown";
}

// group point features into fixed 1°x1° cells: { "y/x": [features] }
function groupDetailCells(features) {
    const cells = {};
    for (const feature of features) {
        const [lon, lat] = feature.geometry.coordinates;
        const y = Math.floor((lat + 90) / DETAIL_CELL_SIZE);
        const x = Math.floor((lon + 180) / DETAIL_CELL_SIZE);
        const key = y + "/" + x;
        (cells[key] = cells[key] || []).push(feature);
    }
    return cells;
}

// group point features into slippy tiles at zoom z: { "x/y": [features] }
function groupSlippyTiles(features, z) {
    const tiles = {};
    for (const feature of features) {
        const [lon, lat] = feature.geometry.coordinates;
        const key = lonToTileX(lon, z) + "/" + latToTileY(lat, z);
        (tiles[key] = tiles[key] || []).push(feature);
    }
    return tiles;
}

// bin the points of one slippy tile into a CLUSTER_BINS x CLUSTER_BINS grid and
// return the tile's features: cluster features for multi-point bins, the original
// point features for single-point bins
function clusterTileFeatures(features, z, x, y) {
    const bins = {};
    const px0 = x * TILE_SIZE;
    const py0 = y * TILE_SIZE;
    const binSize = TILE_SIZE / CLUSTER_BINS;

    for (const feature of features) {
        const [lon, lat] = feature.geometry.coordinates;
        const bx = Math.min(CLUSTER_BINS - 1, Math.max(0, Math.floor((lonToPx(lon, z) - px0) / binSize)));
        const by = Math.min(CLUSTER_BINS - 1, Math.max(0, Math.floor((latToPx(lat, z) - py0) / binSize)));
        const key = by * CLUSTER_BINS + bx;
        (bins[key] = bins[key] || []).push(feature);
    }

    const result = [];
    for (const [key, members] of Object.entries(bins)) {
        if (members.length === 1) {
            result.push(members[0]);
            continue;
        }
        const counts = { farm: 0, marketplace: 0, vending_machine: 0, beekeeper: 0, unknown: 0 };
        let lonSum = 0;
        let latSum = 0;
        for (const member of members) {
            counts[categoryOf(member)]++;
            lonSum += member.geometry.coordinates[0];
            latSum += member.geometry.coordinates[1];
        }
        const by = Math.floor(key / CLUSTER_BINS);
        const bx = key % CLUSTER_BINS;
        result.push({
            type: "Feature",
            id: "cluster/" + z + "/" + x + "/" + y + "/" + by + "-" + bx,
            properties: Object.assign({ cluster: true, count: members.length }, counts),
            geometry: {
                type: "Point",
                coordinates: [lonSum / members.length, latSum / members.length]
            }
        });
    }
    return result;
}

// Build all tiles for a feature list.
// Returns { "tiles/detail/<y>/<x>.json": FeatureCollection, "tiles/cluster/<z>/<x>/<y>.json": FeatureCollection, ... }
function buildTiles(features) {
    const tiles = {};

    for (const [key, members] of Object.entries(groupDetailCells(features))) {
        tiles["tiles/detail/" + key + ".json"] = {
            type: "FeatureCollection",
            features: members
        };
    }

    for (let z = 0; z <= CLUSTER_MAX_ZOOM; z++) {
        for (const [key, members] of Object.entries(groupSlippyTiles(features, z))) {
            const [x, y] = key.split("/").map(Number);
            tiles["tiles/cluster/" + z + "/" + x + "/" + y + ".json"] = {
                type: "FeatureCollection",
                features: clusterTileFeatures(members, z, x, y)
            };
        }
    }

    return tiles;
}

// Tile paths covering a lat/lon bounds {west, south, east, north}.
// Returned without the "tiles/" prefix and ".json" suffix, e.g. "cluster/6/33/21"
// or "detail/141/190" — the frontend loads them from data/tiles/<path>.json.
// Handles bounds crossing the antimeridian (west > east).

function clusterTilePaths(west, south, east, north, z) {
    const n = Math.pow(2, z);
    const paths = [];
    const x0 = Math.min(n - 1, Math.max(0, Math.floor((west + 180) / 360 * n)));
    const x1 = Math.min(n - 1, Math.max(0, Math.floor((east + 180) / 360 * n)));
    const y0 = Math.min(n - 1, Math.max(0, latToTileY(north, z)));
    const y1 = Math.min(n - 1, Math.max(0, latToTileY(south, z)));
    const xs = x0 <= x1
        ? range(x0, x1)
        : range(x0, n - 1).concat(range(0, x1));
    for (const x of xs) {
        for (let y = y0; y <= y1; y++) {
            paths.push("cluster/" + z + "/" + x + "/" + y);
        }
    }
    return paths;
}

function detailCellPaths(west, south, east, north) {
    const n = 360 / DETAIL_CELL_SIZE;
    const paths = [];
    const x0 = Math.min(n - 1, Math.max(0, Math.floor((west + 180) / DETAIL_CELL_SIZE)));
    const x1 = Math.min(n - 1, Math.max(0, Math.floor((east + 180) / DETAIL_CELL_SIZE)));
    const y0 = Math.floor((south + 90) / DETAIL_CELL_SIZE);
    const y1 = Math.floor((north + 90) / DETAIL_CELL_SIZE);
    const xs = x0 <= x1
        ? range(x0, x1)
        : range(x0, n - 1).concat(range(0, x1));
    for (const x of xs) {
        for (let y = y0; y <= y1; y++) {
            paths.push("detail/" + y + "/" + x);
        }
    }
    return paths;
}

function range(from, to) {
    const result = [];
    for (let i = from; i <= to; i++) {
        result.push(i);
    }
    return result;
}

const api = {
    DETAIL_CELL_SIZE,
    CLUSTER_MAX_ZOOM,
    CLUSTER_BINS,
    lonToTileX,
    latToTileY,
    lonToPx,
    latToPx,
    groupDetailCells,
    groupSlippyTiles,
    clusterTileFeatures,
    clusterTilePaths,
    detailCellPaths,
    buildTiles
};

// dual use: require() in Node (update_data.js), window.tilegen in the browser (direktvermarkter.js)
if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
} else {
    window.tilegen = api;
}

// Node-only: writes the tiled data layout (the tile scheme itself lives in
// tilegen.js, which is shared with the frontend and must stay browser-safe).

const fs = require("fs");
const tilegen = require("./tilegen");

function lastUpdateString(date) {
    date = date || new Date();
    const hh = date.getHours();
    let dd = date.getDate();
    let mm = date.getMonth() + 1; // January is 0!
    const yyyy = date.getFullYear();
    if (dd < 10) {
        dd = `0${dd}`;
    }
    if (mm < 10) {
        mm = `0${mm}`;
    }
    return `Letzter Datenabgleich: ${dd}.${mm}.${yyyy} ungefähr um ${hh} Uhr.`;
}

function mkdirSyncRecursive(directory) {
    const parts = directory.replace(/\/+$/, "").split("/").filter((part) => part.length > 0);
    let segment = directory.startsWith("/") ? "/" : "";
    for (const part of parts) {
        segment = segment === "/" ? "/" + part : segment + (segment.length > 0 ? "/" : "") + part;
        if (!fs.existsSync(segment)) {
            fs.mkdirSync(segment);
        }
    }
}

function removeDirRecursive(path) {
    if (!path || path === "/") {
        return;
    }
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach((file) => {
            const curPath = `${path}/${file}`;
            if (fs.lstatSync(curPath).isDirectory()) {
                removeDirRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

// Wipes outDir and writes the full tiled layout for a (normalized) feature list:
//   tiles/cluster/<z>/<x>/<y>.json   precomputed clusters, zoom <= 6
//   tiles/detail/<y>/<x>.json        1x1 degree cells, zoom >= 7
//   tiles/index.json                 list of existing tiles (frontend fetches only these)
//   meta.json                        lastUpdate + feature count
function writeTiles(outDir, features, lastUpdate) {
    removeDirRecursive(outDir);
    fs.mkdirSync(outDir, { recursive: true });

    const tiles = tilegen.buildTiles(features);
    for (const [path, tile] of Object.entries(tiles)) {
        const file = `${outDir}/${path}`;
        mkdirSyncRecursive(file.substring(0, file.lastIndexOf("/")));
        fs.writeFileSync(file, JSON.stringify(tile));
    }

    fs.writeFileSync(`${outDir}/tiles/index.json`, JSON.stringify({
        tiles: Object.keys(tiles).map((path) => path.replace(/^tiles\//, "").replace(/\.json$/, ""))
    }, null, 2));

    fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify({
        lastUpdate: lastUpdate,
        count: features.length,
        generated: new Date().toISOString()
    }, null, 2));

    return { tiles: Object.keys(tiles).length, features: features.length };
}

module.exports = {
    lastUpdateString,
    mkdirSyncRecursive,
    writeTiles
};

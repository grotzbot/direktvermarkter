#!/usr/local/bin/node
const osmtogeojson = require("osmtogeojson");
const fs = require("fs");
const https = require("https");
const tilegen = require("./tilegen");

// usage: node update_data.js [--bbox "minlat,minlon,maxlat,maxlon"]
// default bbox: DACH region (Germany, Austria, Switzerland)
const DEFAULT_BBOX = "46.51351558059737,4.2626953125,55.26659815231191,17.7978515625";

function parseBbox(argv) {
    const i = argv.indexOf("--bbox");
    if (i !== -1 && argv[i + 1]) {
        return argv[i + 1];
    }
    return DEFAULT_BBOX;
}

const bbox = parseBbox(process.argv.slice(2));

function mkdirSyncRecursive(directory) {
    const path = directory.replace(/\/$/, "").split("/");

    for (let i = 1; i <= path.length; i++) {
        const segment = path.slice(0, i).join("/");
        !fs.existsSync(segment) ? fs.mkdirSync(segment) : null;
    }
}

// bounding-box center of a GeoJSON geometry (Point/LineString/Polygon/MultiPolygon)
function geometryCenter(geometry) {
    const positions = [];
    const collect = (coords) => {
        if (typeof coords[0] === "number") {
            positions.push(coords);
        } else {
            coords.forEach(collect);
        }
    };
    collect(geometry.coordinates);
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of positions) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function getSimpleNode(node) {

  if (node.properties)
        if (node.properties.shop === "farm" && node.properties.amenity != "vending_machine") {
            property = "farm";
            //console.log("farm");
        }
        else if (node.properties.craft === "beekeeper" && node.properties.shop != "farm" && node.properties.amenity != "vending_machine") {
            property = "beekeeper";
            //console.log("beekeeper");
        }
        else if (node.properties.amenity === "marketplace" && node.properties.shop != "farm" && node.properties.amenity != "vending_machine") {
            property = "marketplace";
            //console.log("marketplace");
        }
        else if (node.properties.amenity === "vending_machine"&& node.properties.shop != "farm" && node.properties.amenity != "marketplace") {
            property = "vending_machine";
            //console.log("vending_machine");
        }
        else if (node.properties.amenity === "vending_machine") {
            property = "vending_machine";
            //console.log("vending_machine");
      }
        else {
            property = "unknown";
            //console.log("unknown");
      }
        else
            property = null;
            geometry = node.geometry;
            if (geometry && property)
              return simpleNode = {
                "type": "Feature",
                "properties": {
                  "p": property,
                  "id": node.id
                }, geometry
              };
            else
            return null;
}

function removeDataDir(path) {
    if (!path || path === "/") {
        //return console.log(`Removing ${path}`);
    }

    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach((file, index) => {
            const curPath = `${path}/${file}`;
            if (fs.lstatSync(curPath).isDirectory()) {
                // recurse
                removeDataDir(curPath);
            } else {
                // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

removeDataDir("data/");
fs.mkdirSync("data/", { recursive: true });

const today = new Date();
const hh = today.getHours();
let dd = today.getDate();
let mm = today.getMonth() + 1; // January is 0!
const yyyy = today.getFullYear();

if (dd < 10) {
    dd = `0${dd}`;
}
if (mm < 10) {
    mm = `0${mm}`;
}

const lastUpdate = `Letzter Datenabgleich: ${dd}.${mm}.${yyyy} ungefähr um ${hh} Uhr.`;

console.log(lastUpdate);
console.log(`bbox: ${bbox}`);

const vendings = [
    "milk", "egg", "food", "tomato", "cheese",
    "sausage", "potato", "noodle", "meat",
    "honey", "fruit"
];

let query = `
    [out:json][timeout:742][bbox:${bbox}];
    (
      nwr[vending~"${vendings.join("|")}"][vending!=animal_food][operator!~"[Ss]electa"];
      nwr[amenity=marketplace];
      nwr[shop=farm];
      nwr[craft=beekeeper];
    );
    out center;
`;

// query overpass, write to folders by id
const maxAttempts = 3;
// a full DACH query takes several minutes — give overpass-api.de time to recover between attempts
const retryWaits = [300, 500];

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// POST the query to overpass-api.de and resolve with { status, body }.
// Uses node:https instead of fetch on purpose: fetch aborts requests whose response
// headers take more than 5 minutes, but a healthy DACH run can take longer.
// Only a 15 minute socket inactivity timeout applies (the query itself is limited
// to 742s server-side).
function postOverpass(query) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({ data: query }).toString();
        const request = https.request({
            hostname: "overpass-api.de",
            path: "/api/interpreter",
            method: "POST",
            timeout: 900000,
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
                // overpass-api.de rejects requests without a User-Agent with HTTP 406
                "user-agent": "farmshops.eu data update (https://github.com/CodeforKarlsruhe/farmshops.eu)"
            }
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
            response.on("error", reject);
        });
        request.on("timeout", () => request.destroy(new Error("Overpass request timed out after 15 minutes")));
        request.on("error", reject);
        request.write(body);
        request.end();
    });
}

async function fetchOverpass(attempt) {
    let result;
    try {
        result = await postOverpass(query);
    } catch (error) {
        if (attempt < maxAttempts) {
            console.error(`Overpass request failed (${error.message}), retrying in ${retryWaits[attempt - 1]}s (attempt ${attempt + 1}/${maxAttempts})`);
            await sleep(retryWaits[attempt - 1]);
            return fetchOverpass(attempt + 1);
        }
        throw error;
    }

    // under load overpass-api.de answers "server too busy" (504) — retry a few times
    if (result.status >= 500 && attempt < maxAttempts) {
        console.error(`Overpass HTTP ${result.status}, retrying in ${retryWaits[attempt - 1]}s (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(retryWaits[attempt - 1]);
        return fetchOverpass(attempt + 1);
    }

    if (result.status !== 200) {
        throw new Error(`Overpass request failed: HTTP ${result.status}`);
    }

    return osmtogeojson(JSON.parse(result.body), { flatProperties: true });
}

async function updateData() {
    const data = await fetchOverpass(1);
    const features = data.features ? data.features.filter((feature) => feature.geometry) : [];
    if (features.length === 0) {
        throw new Error("Overpass returned no features — refusing to overwrite data/ with an empty result");
    }

    // keep the full properties (for popups) and add the derived category (for marker icons)
    for (const feature of features) {
        // the tile system is point-based: area features (ways/relations mapped as
        // buildings etc.) become a pin at their center — like the old site
        // ("Polygone erhalten einen Pin in ihrem Zentrum")
        if (feature.geometry.type !== "Point") {
            feature.geometry = { type: "Point", coordinates: geometryCenter(feature.geometry) };
        }
        const simpleNode = getSimpleNode(feature);
        feature.properties.p = simpleNode ? simpleNode.properties.p : "unknown";
    }

    // write the tiled data: detail cells + precomputed low-zoom cluster tiles + meta.json
    const tiles = tilegen.buildTiles(features);
    for (const [path, tile] of Object.entries(tiles)) {
        const file = `data/${path}`;
        mkdirSyncRecursive(file.substring(0, file.lastIndexOf("/")));
        fs.writeFileSync(file, JSON.stringify(tile));
    }

    // tile index: lets the frontend fetch only tiles that exist (avoids 404s for empty areas)
    fs.writeFileSync("data/tiles/index.json", JSON.stringify({
        tiles: Object.keys(tiles).map((path) => path.replace(/^tiles\//, "").replace(/\.json$/, ""))
    }, null, 2));

    fs.writeFileSync("data/meta.json", JSON.stringify({
        lastUpdate: lastUpdate,
        count: features.length,
        generated: new Date().toISOString()
    }, null, 2));

    console.log(`${features.length} features -> ${Object.keys(tiles).length} tiles`);
}

updateData().catch((error) => {
    console.error(error);
    process.exit(1);
});

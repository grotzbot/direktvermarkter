// Overpass API access for the farmshops.eu data pipeline.
//
// All queries go to public Overpass instances. To stay far below each
// instance's fair-use limits, worldwide fetches are spread across several
// instances (regions.json assigns one server per region, round-robin) and run
// slowly (the CI matrix uses low parallelism).

const osmtogeojson = require("osmtogeojson");
const http = require("http");
const https = require("https");

// public Overpass instances (see https://wiki.openstreetmap.org/wiki/Overpass_API)
const SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter"
];

const DEFAULT_SERVER = SERVERS[0];

const maxAttempts = 3;
// a full region query takes several minutes — give the server time to recover
// between attempts (override for tests: OVERPASS_RETRY_WAITS="1,2")
const retryWaits = (process.env.OVERPASS_RETRY_WAITS || "300,500").split(",").map(Number);

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// The OSM tags shown on the map (keep in sync with the frontend's category
// mapping — see features.js / js/direktvermarkter.js)
function buildQuery(bbox) {
    const vendings = [
        "milk", "egg", "food", "tomato", "cheese",
        "sausage", "potato", "noodle", "meat",
        "honey", "fruit"
    ];
    return `
    [out:json][timeout:742][bbox:${bbox}];
    (
      nwr[vending~"${vendings.join("|")}"][vending!=animal_food][operator!~"[Ss]electa"];
      nwr[amenity=marketplace];
      nwr[shop=farm];
      nwr[craft=beekeeper];
    );
    out center;
`;
}

// POST the query to an Overpass instance and resolve with { status, body }.
// Uses node:https instead of fetch on purpose: fetch aborts requests whose
// response headers take more than 5 minutes, but a healthy region query can
// take longer. Only a 15 minute socket inactivity timeout applies (the query
// itself is limited to 742s server-side).
function postOverpass(server, query) {
    return new Promise((resolve, reject) => {
        const url = new URL(server);
        const body = new URLSearchParams({ data: query }).toString();
        const request = (url.protocol === "https:" ? https : http).request({
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname,
            method: "POST",
            timeout: 900000,
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
                // Overpass instances reject requests without a User-Agent with HTTP 406
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

async function fetchOverpass(server, query, attempt) {
    let result;
    try {
        result = await postOverpass(server, query);
    } catch (error) {
        if (attempt < maxAttempts) {
            console.error(`Overpass request failed (${error.message}), retrying in ${retryWaits[attempt - 1]}s (attempt ${attempt + 1}/${maxAttempts})`);
            await sleep(retryWaits[attempt - 1]);
            return fetchOverpass(server, query, attempt + 1);
        }
        throw error;
    }

    // under load Overpass answers "server too busy" (504) — retry a few times
    if (result.status >= 500 && attempt < maxAttempts) {
        console.error(`Overpass HTTP ${result.status}, retrying in ${retryWaits[attempt - 1]}s (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(retryWaits[attempt - 1]);
        return fetchOverpass(server, query, attempt + 1);
    }

    if (result.status !== 200) {
        throw new Error(`Overpass request failed: HTTP ${result.status}`);
    }

    return JSON.parse(result.body);
}

// Fetch one region (bbox "minlat,minlon,maxlat,maxlon") and return the
// GeoJSON FeatureCollection (osmtogeojson, flatProperties).
async function fetchFeatures(bbox, server) {
    const data = await fetchOverpass(server || DEFAULT_SERVER, buildQuery(bbox), 1);
    return osmtogeojson(data, { flatProperties: true });
}

module.exports = {
    SERVERS,
    DEFAULT_SERVER,
    buildQuery,
    fetchFeatures
};

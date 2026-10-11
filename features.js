// Feature normalization and merging for the data pipeline.

const CATEGORIES = ["farm", "beekeeper", "marketplace", "vending_machine", "unknown"];

// derive the map category from an OSM feature's tags
function getSimpleNode(node) {
    let property;
    let geometry;

    if (node.properties)
        if (node.properties.shop === "farm" && node.properties.amenity != "vending_machine") {
            property = "farm";
        }
        else if (node.properties.craft === "beekeeper" && node.properties.shop != "farm" && node.properties.amenity != "vending_machine") {
            property = "beekeeper";
        }
        else if (node.properties.amenity === "marketplace" && node.properties.shop != "farm" && node.properties.amenity != "vending_machine") {
            property = "marketplace";
        }
        else if (node.properties.amenity === "vending_machine" && node.properties.shop != "farm" && node.properties.amenity != "marketplace") {
            property = "vending_machine";
        }
        else if (node.properties.amenity === "vending_machine") {
            property = "vending_machine";
        }
        else {
            property = "unknown";
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

// Normalize features for the tile system (which is point-based):
// - area features (ways/relations mapped as buildings etc.) become a pin at
//   their bounding-box center — like the old site ("Polygone erhalten einen
//   Pin in ihrem Zentrum")
// - the derived category is added as properties.p (for marker icons);
//   popupcontent.js skips it when rendering
// Idempotent: already-normalized features pass through unchanged.
function normalizeFeatures(features) {
    const result = [];
    for (const feature of features) {
        if (!feature || !feature.geometry || !feature.properties) {
            continue;
        }
        if (feature.geometry.type !== "Point") {
            feature.geometry = { type: "Point", coordinates: geometryCenter(feature.geometry) };
        }
        const simpleNode = getSimpleNode(feature);
        feature.properties.p = simpleNode ? simpleNode.properties.p : "unknown";
        result.push(feature);
    }
    return result;
}

// Merge feature collections, deduplicating by OSM id (features on region
// borders are returned by more than one region query).
function mergeFeatures(collections) {
    const byId = new Map();
    for (const collection of collections) {
        for (const feature of collection.features || []) {
            byId.set(feature.id, feature);
        }
    }
    return { type: "FeatureCollection", features: [...byId.values()] };
}

module.exports = {
    CATEGORIES,
    getSimpleNode,
    geometryCenter,
    normalizeFeatures,
    mergeFeatures
};

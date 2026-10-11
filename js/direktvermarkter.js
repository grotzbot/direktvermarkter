console.log("        @ @ @\n       []___\n      /    /\\____\n(~)  /_/\\_//____/\\ \n |   | || |||__|||\n     farmshops.eu \n Interesse am Code, Bug gefunden oder eine Verbesserungsidee? Schau vorbei auf GitHub! \n https://github.com/CodeforKarlsruhe/direktvermarkter");
var mappos = L.Permalink.getMapLocation();
var map = L.map('map', {
    center: mappos.center,
    zoom: mappos.zoom,
    minZoom: 2,
    maxZoom: 18,
    zoomControl: false
});
L.Permalink.setup(map);

var tiles =  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
	maxZoom: 19,
	attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});
var Esri_WorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
	attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGO, IGP, swisstopo, and the GIS User Community'
});



var farmMarker = L.ExtraMarkers.icon({
    icon: 'fa-number',
    markerColor: 'green-light',
    shape: 'square',
});

var machineMarker = L.ExtraMarkers.icon({
    icon: 'fa-number',
    markerColor: 'cyan',
    shape: 'square'
});

var beekeeperMarker = L.ExtraMarkers.icon({
    icon: 'fa-number',
    markerColor: 'yellow',
    shape: 'square'
});

var marketMarker = L.ExtraMarkers.icon({
    icon: 'fa-number',
    markerColor: 'orange',
    shape: 'square'
});

var blackMarker = L.ExtraMarkers.icon({
    icon: 'fa-number',
    markerColor: 'black',
    shape: 'circle',
    number: '?'
});


//Darstellung

//Marker 

// cluster icon HTML, shared between the markercluster plugin (zoom >= 7, clusters
// computed on the fly) and the precomputed cluster tiles (zoom <= 6)
function categoryIconHtml(cats) {
    return (cats.farm ? "<img src='img/hof.png' style='height: 14px;'> " : "")
        + (cats.marketplace ? "<img src='img/markt.png' style='height: 14px;'> " : "")
        + (cats.vending_machine ? "<img src='img/automat.png' style='height: 14px;'> " : "")
        + (cats.beekeeper ? "<img src='img/imker.png' style='height: 14px;'> " : "");
}

function clusterIconHtml(count, cats) {
    var inner;
    if (map.getZoom() >= 8) {
        inner = count + "<div style='padding-top:2px;'>" + categoryIconHtml(cats) + "</div>";
    } else {
        inner = "<div style='padding:8px;'>" + count + "</div>";
    }
    return '<div class="circle"><strong>' + inner + '</strong></div>';
}

// one marker icon per category
function pointIcon(feature) {
    var p = feature.properties.p;
    if (p === 'beekeeper') {
        return beekeeperMarker;
    }
    else if (p === 'farm') {
        return farmMarker;
    }
    else if (p === 'marketplace') {
        return marketMarker;
    } else if (p === 'vending_machine') {
        return machineMarker;
    } else {
        console.log("nicht bekannte Daten verwendet: " + p);
        return blackMarker;
    }
}

// add a point feature (from a detail cell or a cluster tile) to the cluster group.
// the popup is rendered from the properties embedded in the tile
function addPointFeature(feature) {
    var coords = feature.geometry.coordinates;
    var marker = L.marker([coords[1], coords[0]], { icon: pointIcon(feature) });
    marker.feature = feature;
    marker.once("click", function () {
        marker.bindPopup(popupcontent(feature, marker)).openPopup();
    });
    markers.addLayer(marker);
    return marker;
}

// add a precomputed cluster (from a cluster tile); clicking zooms in
function addClusterFeature(feature) {
    var coords = feature.geometry.coordinates;
    var p = feature.properties;
    var cluster = L.marker([coords[1], coords[0]], {
        icon: L.divIcon({
            html: clusterIconHtml(p.count, {
                farm: p.farm > 0,
                marketplace: p.marketplace > 0,
                vending_machine: p.vending_machine > 0,
                beekeeper: p.beekeeper > 0
            }),
            className: 'test',
            iconSize: L.point(80, 80)
        })
    });
    cluster.on("click", function () {
        map.setView([coords[1], coords[0]], Math.min(map.getZoom() + 2, map.getMaxZoom()));
    });
    cluster.addTo(map);
    return cluster;
}

map.on('popupopen', function (e) {
  // resize popups to current map size to avoid overflows
  var divmap = document.getElementById('map');
  e.popup.options.maxHeight = 0.8 * divmap.offsetHeight;
  e.popup.options.maxWidth = 0.95 * divmap.offsetWidth;
  e.popup.update();
});

//Changing Cluster radius based on zoom level
var GetClusterRadius = function (zoom) { 
    if (zoom < 12){
        return 80;
    }
    else{
        return 45;
    }
}

var markers = L.markerClusterGroup({
    iconCreateFunction: function (cluster) {
        var cats = { farm: false, marketplace: false, vending_machine: false, beekeeper: false };
        var childMarkers = cluster.getAllChildMarkers();

        for (var c = 0; c < childMarkers.length; c++) {
            var p = childMarkers[c].feature.properties.p;
            if (p === "farm") {
                cats.farm = true;
            }
            else if (p === "beekeeper") {
                cats.beekeeper = true;
            }
            else if (p === "marketplace") {
                cats.marketplace = true;
            }
            else if (p === "vending_machine") {
                cats.vending_machine = true;
            }
            else {
                console.log("nicht betrachteter Markertyp: " + p);
            }
        }

        return L.divIcon({
            html: clusterIconHtml(childMarkers.length, cats),
            className: 'test',
            iconSize: L.point(80, 80)
        });
    },
    spiderfyOnMaxZoom: true,
    maxClusterRadius: GetClusterRadius,
    showCoverageOnHover: true,
    zoomToBoundsOnClick: true,
    removeOutsideVisibleBounds: true,
});

// --- tiled data loading ---
// The map data lives in static tiles (generated by update_data.js, see tilegen.js):
//   zoom <= 6: slippy cluster tiles  data/tiles/cluster/<z>/<x>/<y>.json
//              (precomputed clusters + single points, full properties embedded)
//   zoom >= 7: 1° detail cells       data/tiles/detail/<y>/<x>.json
//              (raw point features, full properties embedded)
// Tiles are fetched on demand for the current viewport and released when they
// leave it. Popups are rendered from the embedded properties — there are no
// per-feature files anymore.

var loadedTiles = {};  // tile path -> { layers: [L.Layer, ...] } (empty areas cached with [])
var pendingTiles = {}; // tile path -> true while a fetch is in flight
var tileIndex = null;  // Set of existing tile paths (data/tiles/index.json); null = not loaded / unavailable
var currentNeeded = {}; // tile paths of the current viewport

function visibleTilePaths() {
    var zoom = Math.floor(map.getZoom());
    var b = map.getBounds();
    if (zoom <= tilegen.CLUSTER_MAX_ZOOM) {
        return tilegen.clusterTilePaths(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), Math.max(0, zoom));
    }
    return tilegen.detailCellPaths(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
}

function addTile(path, tile) {
    var layers = [];
    var features = tile.features || [];
    for (var i = 0; i < features.length; i++) {
        var feature = features[i];
        if (feature.properties.cluster) {
            layers.push(addClusterFeature(feature));
        } else {
            layers.push(addPointFeature(feature));
        }
    }
    loadedTiles[path] = { layers: layers };
}

function unloadTile(path) {
    var layers = loadedTiles[path].layers;
    for (var i = 0; i < layers.length; i++) {
        if (markers.hasLayer(layers[i])) {
            markers.removeLayer(layers[i]);
        } else {
            map.removeLayer(layers[i]);
        }
    }
    delete loadedTiles[path];
}

function loadVisibleTiles() {
    var needed = {};
    var paths = visibleTilePaths();
    for (var i = 0; i < paths.length; i++) {
        // with a tile index, only fetch tiles that exist (no 404 noise for empty areas)
        if (!tileIndex || tileIndex.has(paths[i])) {
            needed[paths[i]] = true;
        }
    }
    currentNeeded = needed;

    // release tiles that left the viewport
    for (var path in loadedTiles) {
        if (!needed[path]) {
            unloadTile(path);
        }
    }

    // fetch tiles entering the viewport (a 404 means an empty area — cache it)
    for (var path in needed) {
        if (!loadedTiles[path] && !pendingTiles[path]) {
            pendingTiles[path] = true;
            $.getJSON("data/tiles/" + path + ".json")
                .done(function (tile) {
                    addTile(path, tile);
                    if (!currentNeeded[path]) {
                        unloadTile(path); // the viewport moved on while fetching
                    }
                })
                .fail(function () {
                    loadedTiles[path] = { layers: [] };
                })
                .always(function () {
                    delete pendingTiles[path];
                });
        }
    }
}

map.addLayer(tiles);
map.addLayer(markers);
map.on("moveend", loadVisibleTiles);

// load the tile index first, then the visible tiles (falls back to fetching
// everything — with 404 caching — if the index is unavailable)
$.getJSON("data/tiles/index.json")
    .done(function (index) {
        tileIndex = new Set(index.tiles);
        loadVisibleTiles();
    })
    .fail(function () {
        loadVisibleTiles();
    });

$.getJSON("data/meta.json", function (meta) {
    $("#lastUpdate").text(meta.lastUpdate);
    console.log(meta.count + " Einträge — " + meta.lastUpdate);
});

var sidebar = L.control.sidebar({ container: 'sidebar' }).addTo(map);

var tilesAuswahl = {
    "OpenStreetMap": tiles,
    "Satellit": Esri_WorldImagery,
};

var overlays = {
    "Marker": markers,
};
L.control.scale({position: 'topright'}).addTo(map);

L.control.layers(tilesAuswahl,overlays).addTo(map);



L.control.zoom({
    position: 'bottomright'
}).addTo(map);


L.control.locate({
    position: 'bottomright',
    drawMarker: true,
    drawCircle: true,
    flyTo: true,
    keepCurrentZoomLevel: false,
    strings: {
        title: "Karte auf meine aktuelle Position zentrieren!"
    },
    locateOptions: {
        maxZoom: 12
    },
    clickBehavior: {
        inView: 'setView', 
        outOfView: 'setView'
    }
}
).addTo(map);

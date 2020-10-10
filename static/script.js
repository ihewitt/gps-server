var mymap = null;
var elevation = null;
var currentPeriod = 1; //set defaults
var rangeMarkers = [];
var rangePath = null;
var latestMarker = null;
var roamarea = null;
var route = null;

var tip = L.icon({
    iconUrl: 'images/circ.png',
    iconSize: [16, 16]
});

var roam = L.icon({
    iconUrl: 'images/pin-icon-end.png'
});

//make user tracker map
var users = {};
var trackers = {};
var courses = {};

var parcourse;
var partid;
var parzoom = 10;
var parperiod = 24;

getDefaults();
initMap();

function getDefaults() {
    params = new URLSearchParams(window.location.search);
    if (params.has('course')) {
        parcourse = params.get('course');
    }
    if (params.has('tid')) {
        partid = params.get('tid');
    }
    if (params.has('period')) {
        parperiod = params.get('period');
    }
    if (params.has('zoom')) {
        parzoom = params.get('zoom');
    }
}

function setDefaults() {
    if (partid) {
        $("#rangeTracker").val(partid);
        $("#rangeTracker").val(partid).trigger('change');
    }
    if (parcourse) {
        $("#rangeCourse").val(parcourse);
        $("#rangeCourse").val(parcourse).trigger('change');
    }
    if (parperiod) {
        $("#rangePeriod").val(parperiod);
        $("#rangePeriod").val(parperiod).trigger('change');
    }
};

function initMap() {
    mymap = L.map('mapid', {
        preferCanvas: true,
        zoom: parzoom
    }).setView([50.819276, -0.136814]); //random default

    ctrl2 = new L.control.custom({ //add footer
        position: 'bottomleft',
        content: '<div id="banhead"> \
        <b><a href="/logout">Logout</a> | <a href="http://blog.ivor.org" target="blog">Blog</a> | <a href="http://blog.ivor.org/2020/07/homebrew-gps-tracking.html" target="blog">About tracker</a> </b></div>',
        style: {
            'margin-bottom': '30px',
            padding: '4px 4px 4px 4px',
            background: '#f0f0f0f0',
            'border-radius': '10px'
        }
    }).addTo(mymap);

    ctrl = new L.control.custom({ //add controls
        position: 'topright',
        content: '<div id="btnhead"><center><b>&#8599; Tracks control</b></center></div>' +
            '<div id="btns"><br><div>Course: &nbsp; <select class="course" id="rangeCourse"></select></div>' +
            '<div>Tracker: &nbsp; <select class="trackerId" id="rangeTracker"></select></div>' +
            '<div>Plot last: &nbsp; <select class="period" id="rangePeriod"></select></div><br>' +
            '<div>' +
            '<button type="button" id="plot">Latest</button>' +
            '<button type="button" id="show">Redraw</button>' +
            '<button type="button" id="locate">Find me</button>' + '</div></div>',
        classes: 'btn-group-vertical btn-group-sm',
        style: {
            padding: '4px 4px 4px 4px',
            cursor: 'pointer',
            background: '#b0b0d0f0',
            'border-radius': '10px'
        }
    }).addTo(mymap);

    $("#btnhead").click(function() {
        var disp = $("#btns").css('display');
        $("#btns").css('display', (disp == 'none') ? 'block' : 'none');
    });

    osmap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    });

    //Add map
    osmap.addTo(mymap);

    /* alternatively
    // logic to switch maps at different zoom levels
    if (parzoom > 12)
        bingmap.addTo(mymap);
    else
        osmap.addTo(mymap);

    mymap.on("zoomend", function(e) {
        if (mymap.getZoom() > 12) {
            osmap.remove();
            bingmap.addTo(mymap);
        } else {
            bingmap.remove();
            osmap.addTo(mymap);
        }
    });
    */

    $("rd").click(function() {});

    //Update marker
    $("#plot").click(function() {
        if (!moveMarker($("#rangeTracker").val())) { //didn't move so bounce
            marker = trackers[$("#rangeTracker").val()].marker;
            marker.remove(); //make bounce
            marker.addTo(mymap);
            marker.openPopup(); //open tooltip
            mymap.setView(marker.getLatLng()); //move to middle
        }
    });

    //Draw track
    $("#show").click(function() {
        showRange($("#rangeTracker").val()); //redraw trail
    });

    //Geolocate browser
    $("#locate").click(function() {
        mymap.locate({
            setView: true
        });
    });

    function onLocationFound(e) {
        if (roamarea) {
            roamarea.remove();
            roamarea = null;
        }
        var radius = e.accuracy;
        roamarea = L.circle(e.latlng, {
            radius: radius,
            color: '#ff00ff'
        }).addTo(mymap).bindPopup("You are within " + parseInt(radius) + " meters from this point").openPopup();
    }
    mymap.on('locationfound', onLocationFound);

    $("#rangePeriod").on('change', function() {
        currentPeriod = $("#rangePeriod").val();
        showRange($("#rangeTracker").val());
    });

    $("#rangeTracker").on('change', function() {
        //update markers.
        moveMarkers();
    });

    $("#rangeCourse").on('change', function() {
        showCourse = $("#rangeCourse").val();
        if (route) {
            route.remove();
            route = null;
        }
        if (showCourse) {
            showTrack(courses[showCourse].gpx);
        }
    });

    setInterval(function() {
        moveMarkers();
    }, 30 * 1000);
}

var checkpoints = [];

/* 
 * Cant find any cleaner way to do this at the moment,
 * so borrow code from utils to grab the created layer
 */
function GPXLoader(data, control) {
    control = control || this;

    control.options.gpxOptions.polyline_options = L.extend({}, control.options.polyline, control.options.gpxOptions.polyline_options);

    if (control.options.theme) {
        control.options.gpxOptions.polyline_options.className += ' ' + control.options.theme;
    }

    var layer = new L.GPX(data, control.options.gpxOptions);

    // similar to L.GeoJSON.pointToLayer
    layer.on('addpoint', function(e) {
        //control.fire("waypoint_added", e);
    });

    // similar to L.GeoJSON.onEachFeature
    layer.on("addline", function(e) {
        control.addData(e.line /*, layer*/ );
        control.track_info = L.extend({}, control.track_info, {
            type: "gpx",
            name: layer.get_name()
        });
    });

    // unlike the L.GeoJSON, L.GPX parsing is async
    layer.once('loaded', function(e) {
        L.Control.Elevation._d3LazyLoader.then(function() {
            control._fireEvt("eledata_loaded", {
                data: data,
                layer: layer,
                name: control.track_info.name,
                track_info: control.track_info
            });
        });
    });

    return layer;
}
var elevation_options = {
    theme: "magenta-theme", // Default chart colors: theme lime-theme, magenta-theme, ...  
    height: 150,
    width: 700,
    detached: false, // Chart container outside/inside map container
    elevationDiv: "#elevation-div", // if (detached), the elevation chart container
    autohide: false, // if (!detached) autohide chart profile on chart mouseleave
    collapsed: true, // if (!detached) initial state of chart profile control
    position: "bottomleft", // if (!detached) control position on one of map corners
    followMarker: true, // Autoupdate map center on chart mouseover.
    imperial: true, // Chart distance/elevation units.
    reverseCoords: false, // [Lat, Long] vs [Long, Lat] points. (leaflet default: [Lat, Long])
    slope: false, // Slope chart profile: true || "summary" || false
    summary: 'line', // Summary track info style: "line" || "multiline" || false
    ruler: true, // Toggle chart ruler filter.
    legend: false, // Toggle chart legend filter.

    gpxOptions: {
        async: true,
        marker_options: {
            iconSize: [30, 45],
            iconAnchor: [15, 45],
            popupAnchor: [0, -45],
            wptIconUrls: {
                'Flag, Green': 'images/pin-icon-start.png',
                'Pin, Blue': 'images/cup.png',
                'Pin, Green': 'images/cup2.png',
                'Pin, Red': 'images/food.png',
                'Flag, Red': 'images/pin-icon-end.png',
            }
        }
    },
    polyline: {
        color: 'red',
        opacity: 0.6,
        weight: 6,
        lineCap: 'round'
    }
};

function showTrack(gpx) {
    checkpoints = [];

    if (!elevation) {
        elevation = L.control.elevation(elevation_options).addTo(mymap);
    }

    elevation.clear();

    $.get(gpx, function(resp, status, xhr) {
        if (status == "success")
            route = GPXLoader(xhr.responseText, elevation);
    });
}

function getText(data) {
    sp = data.speed / 1.609; //probably kph?
    if (data.speed <= 1)
        mm = 0;
    else
        mm = 60 / sp;

    state = '';
    if (data.hasOwnProperty('state')) {
        state = '<b>Status:</b> ' + ((data.state) ? 'Online' : 'Offline') + '<br>';
    } else {
        state = '<b>Status:</b> Offline<br>';
    }
    var contentString = '<div id="content">' +
        '<div id="siteNotice">' +
        '</div>' +
        '<div id="bodyContent">' +
        '<p>' +
        '<b>Timestamp:</b> ' + new Date(data.timestamp).toLocaleString() + '<br>' +
        '<b>GPS time:</b> ' + new Date(data.trackerDate).toLocaleString() + '<br>' +
        '<b>Runner:</b> ' + trackers[data.trackerId].name + '<br>' +
        //        '<b>Id:</b> ' + data.trackerId + '<br>' +
        '<b>Battery:</b> ' + data.battery + '<br>' +
        //        '<b>Speed:</b> ' + sp.toFixed(2) + 'mph<i></i><br>' +
        //        '<b>Pace:</b> ' + decToMM(mm) + 'mm<i></i>' +
        '</p>' +
        '</div>' +
        '</div>';

    return contentString;
}

function showRange(trackerId) {
    d = new Date();
    st = (d.getTime()) - (currentPeriod * 60 * 60 * 1000);
    clearMap();
    addMarkers();
    moveMarkers();

    $.get("/api/range/" + trackerId + "/" + st + "/" + d.getTime(), function(data) {
        if (!data || data.length < 1) {
            console.log("none");
        }
        if (data && data.length > 0) {
            var latLngs = [];

            for (var j = 0; j < data.length; j++)
                latLngs.push([data[j].latitude, data[j].longitude]);

            rangePath = L.polyline(latLngs, {
                color: 'blue',
                opacity: 0.6,
                weight: 6,
                lineCap: 'round'
            }).addTo(mymap);

            //Todo change to time steps
            interval = 5;
            for (var j = 0; j < data.length; j++) {
                text = getText(data[j]);

                if (j % 10 == 0)
                    options = {
                        radius: 8,
                        color: '#ff0000'
                    }
                else
                    options = {
                        radius: 5,
                        stroke: true,
                        weight: 1,
                        fillColor: '#0000ff',
                        color: '#f0f0f0'
                    };
                var marker = L.circleMarker([data[j].latitude, data[j].longitude], options);
                marker.bindPopup(text).openPopup();
                rangeMarkers.push(marker.addTo(mymap));

            }
        }
    });
}

function clearMap() {
    if (rangePath) {
        rangePath.remove();
        rangePath = null;
    }

    for (var i = 0; i < rangeMarkers.length; i++) {
        rangeMarkers[i].remove();
    }
    rangeMarkers = [];

    for (key in trackers) {
        if (trackers[key].marker) {
            trackers[key].marker.remove();
        }
    }

    if (roamarea) {
        roamarea.remove();
        roamarea = null;
    }
}

function decToMM(mph) {
    var sign = mph < 0 ? "-" : "";
    var min = Math.floor(Math.abs(mph));
    var sec = Math.floor((Math.abs(mph) * 60) % 60);
    return sign + "" + min + ":" + (sec < 10 ? "0" : "") + sec;
}

var latestDoc;

var icontrack = new L.icon({
    iconAnchor: [21, 60],
    popupAnchor: [0, -41],
    iconUrl: 'images/centurion2.png',
    shadowUrl: 'images/pin-shadow.png',
    shadowSize: [50, 50],
    shadowAnchor: [10, 48],
    className: 'bounce'
});
var iconplain = new L.icon({
    iconAnchor: [21, 60],
    popupAnchor: [0, -41],
    iconUrl: 'images/purple.png',
    shadowUrl: 'images/pin-shadow.png',
    shadowSize: [50, 50],
    shadowAnchor: [10, 48]
});

function addMarkers() {
    for (id in trackers) {
        tracker = trackers[id];
        if (tracker.active) {
            console.log("add " + id);
            if (id == $("#rangeTracker").val()) {
                z = 2;
                icon = icontrack;
            } else {
                z = 1;
                icon = iconplain;
            }

            marker = new L.marker([0, 0], {
                icon: icon,
                zIndexOffset: z
            });
            marker.addTo(mymap);
            if (tracker.marker)
                tracker.marker.remove();
            tracker.marker = marker;
        }
    }
}

//for all trackers. move markers
function moveMarkers() {
    // not ideal there's no distinct query.
    for (id in trackers) {
        tracker = trackers[id];
        if (tracker.active)
            moveMarker(id);
    }
}

function moveMarker(id) {
    moved = false;
    $.get("/api/latest/" + id, function(data) {
        tracker = trackers[data.trackerId];
        marker = tracker.marker;
        lat = data.latitude;
        lon = data.longitude;
        console.log(tracker.name + "-" + lat + ":" + lon);

        if (marker) {
            if (geoRound(marker.getLatLng().lat) != geoRound(lat) ||
                geoRound(marker.getLatLng().lng) != geoRound(lon)) {
                console.log("Moved update");
                moved = true;

                //Use position if we think valid
                if (data.trackingState == 'A')
                    marker.setLatLng([lat, lon]);

                text = getText(data);
                marker.bindPopup(text);
                marker.update();

                //tracking this so move and path
                if (id == $("#rangeTracker").val()) {
                    mymap.setView(marker.getLatLng());
                    // Extend the path
                    if (rangePath)
                        rangePath.addLatLng([lat, lon]);
                    marker.update();
                }
            }
        }
    });
    return moved;
}

function displayTracker(id) {
    tracker = trackers[id];
    if (!tracker.state)
        tracker.marker.remove(); //see if there's a hide instead
    else
        tracker.marker.addTo(mymap);
}

function geoRound(inValue) {
    return Math.round(inValue * 10000000) / 10000000
}

jQuery(function() {
    $(".course").append("<option value=''>-none-</option>");

    $(".period").append("<option value='1'>1hr</option><option value='4'>4hr</option><option value='12'>12hr</option><option value='24'>24hr</option><option value='48'>2d</option><option value='72'>3d</option><option value='168'>7d</option>");

    $.getJSON("config.json", function(json) {

        $.each(json.trackers, function(id, tracker) {
            tracker.active = false; //default off
            users[tracker.name] = tracker;
            trackers[tracker.tracker] = tracker;
        });

        $.each(json.courses, function(id, course) {
            courses[course.name] = course;
            $(".course").append("<option value='" + course.name + "'>" + course.name + "</option>");
        });

        getTrackers();

    });

});

function getTrackers() {
    // Get tracker info
    $.get("/api/trackerlist", function(data) { //just returns ids of live trackers

        list = '';
        for (var i = 0; i < data.length; i++) {
            id = data[i];
            if (trackers[id]) {
                var name = trackers[id].name;
                trackers[id].state = true; //have we got data
                trackers[id].active = true;
                //add 'online'
                list += '<div id="' + id + '"><input type="checkbox" id=' + id + ' checked></input><label>' + name + '</label></div>';
            }
        }

        //add control
        ctrl2 = new L.control.custom({
            position: 'bottomright',
            content: '<div id="trackers"><center><b>&#8599; Trackers</b></center></div>' +
                '<div id="btns2">' + list + '</div>',
            classes: 'btn-group-vertical btn-group-sm',
            style: {
                margin: '10px',
                padding: '4px 4px 4px 4px',
                cursor: 'pointer',
                background: '#b0b0d0f0',
                'border-radius': '10px'
            }
        }).addTo(mymap);

        //Assign ids. TODO move this up.
        for (name in trackers) {
            $('#' + name).change(function(e) {
                id = e.target.id;
                trackers[id].state = e.target.checked;
                displayTracker(id);
            });
        }

        //Populate tracker selector
        for (track in trackers) {
            tracker = trackers[track];
            if (tracker.active)
                $(".trackerId").append("<option value='" + track + "'>" + tracker.name + "</option>")
        }

        $("#trackers").click(function() { //show hide control
            var disp = $("#btns2").css('display');
            $("#btns2").css('display', (disp == 'none') ? 'block' : 'none');
        });

        setDefaults();
    });
};
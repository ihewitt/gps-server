// GPS tracking server for custom tracker
// 
// Originally based on https://github.com/michaelkleinhenz/tk102b-server
//
// http://blog.ivor.org  twit: @ivor_hewitt 
// Tracker hardware info:
//   https://blog.ivor.org/2020/10/tracking-running-part-2.html and
//   https://blog.ivor.org/2020/07/homebrew-gps-tracking.html

// Just switch to https for https server here, but provide keys files

//const https = require('https');
const https = require('http');
// Setup keys for https mode
const options = {
    //    key: fs.readFileSync('privkey.pem'),
    //    cert: fs.readFileSync('cert.pem')
};

const fs = require('fs');

//Point at global configuration
var config = require(process.env.CONFIGFILE || "./config.json");

//Change to proper database, and/or clear/archive old data
var net = require('net');
var Datastore = require('nedb');
var db = new Datastore({
    filename: config.databasePath,
    autoload: true
});

//Convert degrees and minutes into floating point
function degreeToFloat(degree, min, flag) {
    var result = degree + (min / 60);
    if (flag == "S" || flag == "W")
        result *= -1;
    return result;
}

//merge these into a struct
var trackerBattery = {};
var trackerState = {};


//TODO detect and put each socket into run 'mode' for type of tracker, point tracker at this server
//and this server at the device server.
var server = net.createServer(function(socket) {

    var message = Buffer.alloc(0);
    socket.on('data', function(data) { // Data received function
        //Filter junk from web scanners
        if (data.includes('User-Agent:') ||
            data.includes('Cookie:')) {
            socket.destroy();
            return;
        }

        tstamp = new Date().toISOString();
        console.log(tstamp + `Buffer length - ${data.length}`);

        message = Buffer.concat([message, data]);

        //console.log('IN:' + data.toString());
        // Process any (..) or *...# or ...\n
        var pos = 0;
        do {
            if (message[0] == '*'.charCodeAt()) { // * to # for our message delimeters
                pos = message.indexOf('#') + 1;
            } else if (pos = (message.indexOf('\n') + 1)) { //take a line           
                if (pos == 1)
                    message = message.slice(pos);
            } else //sanity check incase of fragment.
            {
                var begin; //jump to next known start char
                if (
                    begin = message.indexOf('*') > 0) {
                    message = message.slice(begin); //trim
                } else {
                    message = Buffer.alloc(0); // dump
                }
                pos = 0;
            }
            if (pos > 1) //str line end
            {
                handleLine(message.slice(0, pos + 1), socket);
                message = message.slice(pos);
            }
        } while (pos && message.length);
    });

    socket.on('close', function() {
        message = Buffer.alloc(0); //bin 
        //console.log(new Date() + " - Client disconnected: " + socket.remoteAddress);
    });

    socket.on('error', function(err) {
        message = Buffer.alloc(0); //bin
        console.log(new Date() + ` - Error: ${socket.remoteAddress} - ${err.message}`);
    });
});

// TODO spilt the web handler and socket handler into two distinct pieces.
function handleLine(data, socket) {
    var m;

    //DIY tracker
    if (data.slice(0, 3) != "*IV")
        return;

    // Our tracker string
    var ivr = /\*IVR,(\d+),(\d+),(-?\d+\.\d+),(-?\d+\.\d+),([A|V]),.*?,(.*?),.*?,(\d+)#/;
    if ((m = ivr.exec(data)) != null) {
        var dreg = /([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})/;
        dt = dreg.exec(m[2]);

        //Still keep logging battery. and display debug.
        trackerState[m[1]] = true;
        var doc = {
            type: "trackerinfo",
            timestamp: new Date(),
            trackerId: m[1],
            trackerDate: new Date("20" + dt[1] + "." + dt[2] + "." + dt[3] + " " + dt[4] + ":" + dt[5] + ":" + dt[6] + "Z"),
            trackingState: m[5],
            latitude: m[3],
            longitude: m[4],
            altitude: m[6],
            battery: m[7],
            origData: m[0]
        };
        if (dt[1] >= 80) { //TODO make more sane we shouldnt get these now. but if we do log as bad.
            console.log(`${doc.trackerId} ${doc.trackerDate.toISOString()} [X] [${doc.latitude}/${doc.longitude}] B${doc.battery} ${doc.origData}`);
            logBattery(doc.trackerId, doc.battery);
            return;
        } else {
            console.log(`${doc.trackerId} ${doc.trackerDate.toISOString()} [${doc.trackingState}] [${doc.latitude}/${doc.longitude}] B${doc.battery} ${doc.origData}`);
            db.insert(doc, function(err, newDoc) {
                if (err)
                    console.log("Database Error: " + err.message);
            });
        }
    }

    function logBattery(tracker, level) {
        // store this info also for stats lookup.
        var batdoc = {
            type: "battery",
            timestamp: new Date(),
            trackerId: tracker,
            level: level
        }

        db.insert(batdoc, function(err, newDoc) {
            if (err)
                console.log("Database Error: " + err.message);
        });
        console.log(`Tracker: ${tracker} Battery: ${level}`);
        trackerBattery[tracker] = level;
        return level;
    }
};

server.listen(config.trackerPort, '0.0.0.0');

var express = require('express');
var cookieParser = require('cookie-parser');
var basicAuth = require('basic-auth');
var app = express();
var router = express.Router();

app.set('view engine', 'jade');
app.use(express.static('static'));
app.use(cookieParser())


var auth = function(req, res, next) {
    var user = basicAuth(req);
    if (!user || !user.name || !user.pass) {
        res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
        res.status(401).send('Login required');
    } else
    if (user && user.name === config.username && user.pass === config.password) {
        req.user = user.name;
        next();
    } else {
        res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
        res.status(401).send('Login required');
    }
};

//Update all trackers?
router.get('/latest', auth, function(req, res) {

    end = new Date(config.openStart);
    fFun = filterDoc;

    db.find({
        $where: fFun,
        $and: [{
            type: "trackerinfo"
        }, {
            trackingState: {
                $ne: 'V'
            }
        }]
    }).sort({
        timestamp: -1
    }).limit(1).exec(function(err, docs) {
        if (err)
            res.sendStatus(500, err.message);
        else {
            if (docs[0]) {
                doc = docs[0];
                doc['state'] = trackerState[doc.trackerId];
                res.json(doc);
            } else {
                res.sendStatus(404);
            }
        }
    });
});

//get single tracker info
router.get('/latest/:trackerId', auth, function(req, res) {
    //console.log(config.openTrackers);
    if (!config.openTrackers.includes(req.params.trackerId)) {
        res.sendStatus(404);
        return;
    }

    begin = new Date(config.openStart);
    fFun = filterDoc;

    db.find({
        $where: fFun,
        $and: [{
            trackerId: req.params.trackerId
        }, {
            trackingState: {
                $ne: 'V'
            }
        }, {
            type: "trackerinfo"
        }]
    }).sort({
        trackerDate: -1
    }).limit(1).exec(function(err, docs) {
        if (err)
            res.sendStatus(500, err.message);
        else {
            if (docs[0]) {
                doc = docs[0];
                if (doc.timestamp < begin) {
                    doc.latitude = config.openZone.latitude; //Not tracking yet
                    doc.longitude = config.openZone.longitude;
                }
                doc['state'] = trackerState[doc.trackerId]; // add last known state
                res.json(doc);
            } else {
                res.sendStatus(404);
            }
        }
    });
});


function nearGeo(loc1, loc2) {
    var del = 0.01;
    d1 = Math.abs(loc1.latitude - loc2.latitude);
    d2 = Math.abs(loc1.longitude - loc2.longitude);
    return ((d1 < del) && (d2 < del));
}

// Optional filter out points, eg geofence
function filterDoc() {
    targ = config.openZone;
    if (targ) {
        return (!nearGeo(targ, {
            latitude: this.latitude,
            longitude: this.longitude
        }))
    } else {
        return true;
    }
}

router.get('/range/:trackerId/:start/:end', auth, function(req, res) {
    var tsS = new Date(parseInt(req.params.start));
    var tsE = new Date(parseInt(req.params.end));
    cut = new Date(config.openStart);

    var fFun = function() {
        return true
    };

    fFun = filterDoc;
    if (tsS < cut)
        tsS = cut;

    db.find({
        $where: fFun,
        $and: [{
                trackerId: req.params.trackerId
            },
            {
                trackingState: {
                    $ne: 'V'
                }
            },
            {
                trackerDate: {
                    $gte: tsS
                }
            },
            {
                trackerDate: {
                    $lte: tsE
                }
            }
        ]
    }).sort({
        trackerDate: 1
    }).exec(function(err, docs) {
        if (err)
            res.sendStatus(500, err.message);
        else
        if (docs) {
            res.json(docs);
        } else
            res.sendStatus(404);
    });
});

router.get('/trackerlist', auth, function(req, res) {
    db.find({}, {
        trackerId: 1
    }).exec(function(err, docs) {
        if (err)
            res.sendStatus(500, err.message);
        else if (docs) {
            var list = [];
            for (var i = 0; i < docs.length; i++) {
                if (list.indexOf(docs[i].trackerId) == -1 &&
                    (config.openTrackers.includes(docs[i].trackerId)))
                    list.push(docs[i].trackerId);
            }
            res.json(list);
        } else
            res.sendStatus(404);
    });
});

app.use('/api', router);

app.get('/logout', function(req, res) {
    res.cookie('auth', ''); //clear guest token
    res.set('Content-Type', 'text/html');
    res.status(401).send('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=/"></head></html>');
});

app.get("/", auth, function(req, res) {
    res.render("index", {});
});

var httpsServer = https.createServer(options, app);

httpsServer.listen(config.httpPort, function() {
    console.log('Web interface listening on port ' + config.httpPort);
    console.log('Tracker interface listening on port ' + config.trackerPort);
});
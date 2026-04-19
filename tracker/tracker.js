const TrackerServer = require('bittorrent-tracker').Server;

const server = new TrackerServer({
    udp: false,
    http: true, 
    ws: true,
    stats: true,
    trustProxy: true
});

server.on('error', function (err) {
    console.log('Tracker error:', err.message);
});

server.on('listening', function () {
    console.log('P2P Tracker listening on port ' + server.ws.address().port);
});

server.listen(8000, '0.0.0.0');
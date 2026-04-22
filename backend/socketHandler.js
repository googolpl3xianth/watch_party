// socketHandler.js
const registerRoomHandlers = require('./sockets/roomHandler');
const registerVideoHandlers = require('./sockets/videoHandler');

module.exports = function(io, socket) {
    socket.data.currentRoomId = null;

    registerRoomHandlers(io, socket);
    registerVideoHandlers(io, socket);
};
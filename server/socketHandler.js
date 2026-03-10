// socketHandler.js
const registerRoomHandlers = require('./handlers/roomHandler');
const registerVideoHandlers = require('./handlers/videoHandler');

module.exports = function(io, socket) {
    socket.data.currentRoomId = null;

    registerRoomHandlers(io, socket);
    registerVideoHandlers(io, socket);
};
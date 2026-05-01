// socketHandler.js
const registerRoomHandlers = require('./roomHandler');
const registerVideoHandlers = require('./videoHandler');

module.exports = function(io, socket) {
    socket.data.currentRoomId = null;

    registerRoomHandlers(io, socket);
    registerVideoHandlers(io, socket);
};
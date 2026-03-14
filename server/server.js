const { runStartupCleanup } = require('./utils.js');
const socketHandler = require('./socketHandler');

runStartupCleanup();

const io = require('socket.io')(3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// When a new user connects, pass them to the handler
io.on('connection', (socket) => {
    socketHandler(io, socket);
});

//console.log("Watch Party Server running on port 3000");
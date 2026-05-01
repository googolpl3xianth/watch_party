const { runStartupCleanup, initializeVideoList} = require('./utils/utils.js');
const socketHandler = require('./sockets/socketHandler.js');

async function bootServer() {
    await runStartupCleanup();
    await initializeVideoList();
}
bootServer();

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
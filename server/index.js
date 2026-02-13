const io = require('socket.io')(3000, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


const rooms = {}; // Memory to store { roomId: { time, isPaused } }
const users = {}; // {roomId: { username, permisionlv }}

io.on('connection', (socket) => {
    const roomId = socket.handshake.query.roomId;
    if (!roomId) return;

    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);

    if (!rooms[roomId]) {
        rooms[roomId] = { currentTime: 0, isPaused: true };
    }

    socket.emit('apply-sync', { 
        type: rooms[roomId].isPaused ? 'pause' : 'play', 
        time: rooms[roomId].currentTime 
    });

    socket.on('sync-event', (data) => {
        rooms[roomId].currentTime = data.time;
        rooms[roomId].isPaused = (data.type === 'pause');

        socket.to(roomId).emit('apply-sync', data);
    });
});
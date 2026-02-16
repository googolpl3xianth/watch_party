const io = require('socket.io')(3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const activeRooms = {}; // Memory to store { roomId: { time, isPaused, users: {username, permisionlv} } }

io.on('connection', (socket) => {
    let currentRoomId = null;

    socket.on('request-create-room', () => {
        const newID = Math.random().toString(36).substring(2, 8);
        activeRooms[newID] = {currentTime: 0, isPaused: true, users: {}};

        console.log(`Room created: ${newID} by host: ${socket.id}`);
        socket.emit('room-created', newID);
    });

    socket.on('join-room', (roomId) => {
        if (activeRooms[roomId]) {
            socket.join(roomId);
            currentRoomId = roomId;

            const users = activeRooms[roomId].users;
            if(!(socket.id in users)){
                const hasHost = Object.values(users).includes('host');
                if(!hasHost){
                    users[socket.id] = 'host';
                    console.log(`Roomid: ${currentRoomId} ${socket.id} promoted to Host`);
                }
                if (!users[socket.id]) {
                    users[socket.id] = 'guest';
                }
            }

            console.log(`Joined room, Roomid: ${currentRoomId} isPaused: ${activeRooms[roomId].isPaused} currentTime: ${activeRooms[roomId].currentTime}`);

            socket.emit('apply-sync', { 
                type: activeRooms[roomId].isPaused ? 'pause' : 'play', 
                time: activeRooms[roomId].currentTime 
            });

            console.log(`Roomid: ${currentRoomId} User Joined: ${socket.id}`);
            socket.emit('join-success', users[socket.id]);
        } else {
            socket.emit('join-error', 'This room does not exist or has expired.');
        }
    });

    socket.on('request-sync', () => {
        if (activeRooms[currentRoomId]) {
            console.log(`Requested-sync Roomid: ${currentRoomId} isPaused: ${activeRooms[currentRoomId].isPaused} currentTime: ${activeRooms[currentRoomId].currentTime}`);
            socket.emit('apply-sync', {
                type: activeRooms[currentRoomId].isPaused ? 'pause' : 'play',
                time: activeRooms[currentRoomId].currentTime
        });
    }
    });

    socket.on('sync-event', (data) => {
        if (!currentRoomId || !activeRooms[currentRoomId]) return;

        const userRole = activeRooms[currentRoomId].users[socket.id];
        if (userRole !== 'host' && userRole !== 'admin') {
            console.log(`Roomid: ${currentRoomId}Permission denied for ${socket.id}`);
            return;
        }

        console.log(`Sync-event triggered by ${socket.id}, time : ${activeRooms[currentRoomId].currentTime} -> ${data.time}, isPaused: ${activeRooms[currentRoomId].isPaused} -> ${(data.type !== 'play')} type: ${data.type}`);

        activeRooms[currentRoomId].currentTime = data.time;
        if(data.type === 'play'){
            activeRooms[currentRoomId].isPaused = false;
        }
        else if(data.type === 'pause'){
            activeRooms[currentRoomId].isPaused = true;
        }

        socket.to(currentRoomId).emit('apply-sync', data);
    });

    socket.on('disconnect', () => {
        const roomToCleanup = currentRoomId;
        if (roomToCleanup && activeRooms[roomToCleanup]) {
            const wasHost = activeRooms[roomToCleanup].users[socket.id] === 'host';
            delete activeRooms[roomToCleanup].users[socket.id];

            if (wasHost) {
                console.log(`Roomid: ${currentRoomId} Host ${socket.id} left. Migrating host...`);
                
                const remainingUserIds = Object.keys(activeRooms[currentRoomId].users);

                if (remainingUserIds.length > 0) {
                    const newHostId = remainingUserIds[0];
                    activeRooms[currentRoomId].users[newHostId] = 'host';
                    
                    io.to(newHostId).emit('switch-permission', 'host');
                    console.log(`Roomid: ${currentRoomId} User ${newHostId} promoted to Host.`);
                }
            }

            setTimeout(() => { 
                if (!activeRooms[roomToCleanup]) return;

                const currentSize = io.sockets.adapter.rooms.get(roomToCleanup)?.size || 0; 

                if (currentSize === 0) {
                    delete activeRooms[roomToCleanup]; 
                    console.log(`Room ${roomToCleanup} deleted because it is empty.`);
                }
            }, 5000);
        }
    });
});
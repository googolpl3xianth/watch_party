
const { activeRooms } = require('../store');

module.exports = function(io, socket) {
    // Syncs
    socket.on('request-sync', () => {
        const room = activeRooms[socket.data.currentRoomId];
        
        if (room && room.host) {
            if(socket.id !== room.host){
                socket.to(room.host).emit('get-video-status', { requesterId: socket.id });
            }
        }
    });

    socket.on('host-video-status', (data) => {
        if (activeRooms[socket.data.currentRoomId]) {
            activeRooms[socket.data.currentRoomId].status = data.paused ? 'pause' : 'play';
            activeRooms[socket.data.currentRoomId].currentTime = data.time;
            io.to(data.requesterId).emit('apply-sync', {
                type: activeRooms[socket.data.currentRoomId].status,
                time: activeRooms[socket.data.currentRoomId].currentTime
            });
        }
    });

    socket.on('sync-event', (data) => {
        if (!socket.data.currentRoomId || !activeRooms[socket.data.currentRoomId]) return;

        const userRole = activeRooms[socket.data.currentRoomId].users[socket.id].role;
        if (userRole !== 'host' && userRole !== 'admin') {
            //console.log(`Roomid: ${socket.data.currentRoomId}Permission denied for ${socket.id}`);
            return;
        }

        //console.log(`Sync-event triggered by ${socket.id}, time : ${activeRooms[socket.data.currentRoomId].currentTime} -> ${data.time}, status: ${activeRooms[socket.data.currentRoomId].status} -> ${(data.type !== 'play')} type: ${data.type}`);

        activeRooms[socket.data.currentRoomId].currentTime = data.time;
        if(data.type === 'play'){
            if(activeRooms[socket.data.currentRoomId].bufferingUsers.size !== 0){
                //console.log("Play denied: Users are still buffering");
                return;
            }
            activeRooms[socket.data.currentRoomId].status = 'play';
        }
        else if(data.type === 'pause'){
            activeRooms[socket.data.currentRoomId].status = 'pause';
        }

        io.to(socket.data.currentRoomId).emit('apply-sync', data);
    });

    socket.on('host-quality-change', (levelIndex) => {
        if (!socket.data.currentRoomId || !activeRooms[socket.data.currentRoomId]) return;

        const userRole = activeRooms[socket.data.currentRoomId].users[socket.id].role;
        if (userRole === 'host' || userRole === 'admin') {
            activeRooms[socket.data.currentRoomId].videoQuality = levelIndex;
            socket.to(socket.data.currentRoomId).emit('apply-quality', levelIndex);
        }
    });

    // buffering logic
    socket.on('client-buffering', () => {
        if (socket.data.currentRoomId && activeRooms[socket.data.currentRoomId]) {
            activeRooms[socket.data.currentRoomId].bufferingUsers.add(socket.id);
            if (activeRooms[socket.data.currentRoomId].status !== 'pause') {
                activeRooms[socket.data.currentRoomId].status = 'buffer';
                io.to(socket.data.currentRoomId).emit('apply-sync', {
                    type: activeRooms[socket.data.currentRoomId].status,
                    time: activeRooms[socket.data.currentRoomId].currentTime
                });
                io.to(socket.data.currentRoomId).emit('bufferingList', [...activeRooms[socket.data.currentRoomId].bufferingUsers]);
            }
        }
    });

    socket.on('client-recovered', () => {
        if (socket.data.currentRoomId && activeRooms[socket.data.currentRoomId]) {
            activeRooms[socket.data.currentRoomId].bufferingUsers.delete(socket.id);
            if(activeRooms[socket.data.currentRoomId].status !== 'pause'){
                if (activeRooms[socket.data.currentRoomId].bufferingUsers.size === 0) {
                    activeRooms[socket.data.currentRoomId].status = 'play';
                    io.to(socket.data.currentRoomId).emit('apply-sync', {
                        type: activeRooms[socket.data.currentRoomId].status,
                        time: activeRooms[socket.data.currentRoomId].currentTime
                    });
                }
                io.to(socket.data.currentRoomId).emit('bufferingList', [...activeRooms[socket.data.currentRoomId].bufferingUsers]);
            }
        }
    });
};
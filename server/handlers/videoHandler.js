
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
            activeRooms[socket.data.currentRoomId].isPaused = data.paused;
            activeRooms[socket.data.currentRoomId].currentTime = data.time;
            socket.to(data.requesterId).emit('apply-sync', {
                type: activeRooms[socket.data.currentRoomId].isPaused ? 'pause' : 'play',
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

        //console.log(`Sync-event triggered by ${socket.id}, time : ${activeRooms[socket.data.currentRoomId].currentTime} -> ${data.time}, isPaused: ${activeRooms[socket.data.currentRoomId].isPaused} -> ${(data.type !== 'play')} type: ${data.type}`);

        activeRooms[socket.data.currentRoomId].currentTime = data.time;
        if(data.type === 'play'){
            activeRooms[socket.data.currentRoomId].isPaused = false;
        }
        else if(data.type === 'pause'){
            activeRooms[socket.data.currentRoomId].isPaused = true;
        }

        socket.to(socket.data.currentRoomId).emit('apply-sync', data);
    });

    // buffering logic
    socket.on('client-buffering', () => {
        if (socket.data.currentRoomId && activeRooms[socket.data.currentRoomId]) {
            activeRooms[socket.data.currentRoomId].bufferingUsers.add(socket.id);
            //console.log(`Room ${socket.data.currentRoomId}: User ${socket.id} is buffering. Pausing room.`);
            if (!activeRooms[socket.data.currentRoomId].isPaused) {
                socket.to(socket.data.currentRoomId).emit('force-pause-room', socket.id);
            }
        }
    });

    socket.on('client-recovered', () => {
        if (socket.data.currentRoomId && activeRooms[socket.data.currentRoomId]) {
            activeRooms[socket.data.currentRoomId].bufferingUsers.delete(socket.id);
            //console.log(`Room ${socket.data.currentRoomId}: User ${socket.id} recovered. Resuming room.`);
            if (activeRooms[socket.data.currentRoomId].bufferingUsers.size === 0 && !activeRooms[socket.data.currentRoomId].isPaused) {
                socket.to(socket.data.currentRoomId).emit('resume-room');
            }
        }
    });
};
const { activeRooms, creationSpamFilter, roomSpamTimer } = require('../store');
const { getVideoList, sanitize, checkFileSubtitles } = require('../utils');

module.exports = function(io, socket) {

    getVideoList().then(list => {
        socket.emit('video-list', list);
    });

    // Room creation
    socket.on('request-create-room', () => {
        const userIp = socket.handshake.headers['x-real-ip'] || socket.handshake.address;
        const now = Date.now();

        if (creationSpamFilter.has(userIp) && (now - creationSpamFilter.get(userIp) < roomSpamTimer)) {
            //console.log(`Spam blocked from IP: ${userIp}`);
            return socket.emit('join-error', 'Please wait 15 seconds before creating another room.');
        }

        creationSpamFilter.set(userIp, now);

        const newID = Math.random().toString(36).substring(2, 8);
        activeRooms[newID] = {currentTime: 0, isPaused: true, host: null, users: {}, bufferingUsers: new Set()};

        //console.log(`Room created: ${newID} by host: ${socket.id}`);
        socket.emit('room-created', newID);
    });

    socket.on('join-room', (roomId) => {
        if (activeRooms[roomId]) {
            socket.join(roomId);
            socket.data.currentRoomId = roomId;

            let role = 'guest';
            const users = activeRooms[roomId].users;

            if(!(socket.id in users)){
                if(!activeRooms[roomId].host){
                    role = 'host';
                    activeRooms[roomId].host = socket.id;
                    //console.log(`Roomid: ${socket.data.currentRoomId} ${socket.id} promoted to Host`);
                }
                users[socket.id] = {
                    role: role,
                    username:`User-${socket.id.substring(0, 4)}`
                };
            }
            //console.log(`Roomid: ${socket.data.currentRoomId} User Joined: ${socket.id}`);
            socket.emit('join-success', users[socket.id].role);
            io.to(roomId).emit('update-user-list', activeRooms[socket.data.currentRoomId].users);
        } else {
            socket.emit('join-error', 'This room does not exist or has expired.');
        }
    });

    // loading video
    socket.on('request-video-change', (filename) => {
        if (!socket.data.currentRoomId || !activeRooms[socket.data.currentRoomId]) return;
        activeRooms[socket.data.currentRoomId].video_name = filename;
        io.to(socket.data.currentRoomId).emit('load-new-video', filename);
    });

    socket.on('request-load-video', () => {
        if (!socket.data.currentRoomId || !activeRooms[socket.data.currentRoomId]) return;
        if (activeRooms[socket.data.currentRoomId].video_name) {
            //console.log(`Sending current video to late joiner in ${socket.data.currentRoomId}`);
            socket.emit('load-new-video', activeRooms[socket.data.currentRoomId].video_name);
        }
    });

    socket.on('check-subtitles', (filename, callback) => {
        checkFileSubtitles(filename, callback);
    });

    socket.on('request-user-change', (targetID, targetUsername, targetRole) => {
        if (!socket.data.currentRoomId || !activeRooms[socket.data.currentRoomId]) return;

        const requesterRole = activeRooms[socket.data.currentRoomId].users[socket.id].role;
        const finalID = targetID || socket.id; 

        if (targetRole || (targetID && targetID !== socket.id)) {
            if (requesterRole !== 'host' && requesterRole !== 'admin') {
                //console.log(`Exploit blocked: Guest ${socket.id} tried to change roles/users.`);
                return; 
            } 
            else if(targetID && targetID !== socket.id && requesterRole === 'admin' && activeRooms[socket.data.currentRoomId].users[finalID].role === 'host'){
                //console.log(`Exploit blocked: Admin ${socket.id} tried to change roles/users of host.`);
                return; 
            }
        }
        
        if (finalID && activeRooms[socket.data.currentRoomId] && activeRooms[socket.data.currentRoomId].users[finalID]) {
            const remainingUserIds = Object.keys(activeRooms[socket.data.currentRoomId].users);
            if(targetRole === 'host'){
                activeRooms[socket.data.currentRoomId].users[activeRooms[socket.data.currentRoomId].host].role = 'admin';
                io.to(socket.data.currentRoomId).emit('switch-permission', activeRooms[socket.data.currentRoomId].host, null, 'admin');
                activeRooms[socket.data.currentRoomId].host = finalID;
            }
            else if(activeRooms[socket.data.currentRoomId].users[finalID].role === 'host' && (remainingUserIds.length > 1)){
                let newHostId = remainingUserIds[0];
                for(const id of remainingUserIds){
                    if(activeRooms[socket.data.currentRoomId].users[id].role === 'admin'){
                        newHostId = id;
                        break;
                    }
                    else if(id != finalID){
                        newHostId = id;
                    }
                }
                activeRooms[socket.data.currentRoomId].host = newHostId;
                activeRooms[socket.data.currentRoomId].users[newHostId].role = 'host';
                io.to(socket.data.currentRoomId).emit('switch-permission', newHostId, null, 'host');
            }
            if (targetUsername) {
                targetUsername = sanitize(targetUsername);
                activeRooms[socket.data.currentRoomId].users[finalID].username = targetUsername;
            }
            if (targetRole && (remainingUserIds.length > 1)) {
                activeRooms[socket.data.currentRoomId].users[finalID].role = targetRole;
            }
            
            //console.log(`Server successfully updated ${finalID} to role: ${targetRole}`);
            
            io.to(socket.data.currentRoomId).emit('switch-permission', finalID, targetUsername, targetRole);
            io.to(socket.data.currentRoomId).emit('update-user-list', activeRooms[socket.data.currentRoomId].users);
        }
    });

    socket.on('disconnect', () => {
        const roomToCleanup = socket.data.currentRoomId;
        if (roomToCleanup && activeRooms[roomToCleanup]) {
            const wasHost = activeRooms[roomToCleanup].users[socket.id].role === 'host';
            delete activeRooms[roomToCleanup].users[socket.id];
            if (activeRooms[roomToCleanup].bufferingUsers.has(socket.id)) {
                activeRooms[roomToCleanup].bufferingUsers.delete(socket.id);
                if (activeRooms[roomToCleanup].bufferingUsers.size === 0 && !activeRooms[roomToCleanup].isPaused) {
                    socket.to(roomToCleanup).emit('resume-room');
                }
            }
            socket.to(roomToCleanup).emit('user-left', socket.id);

            if (wasHost) {
                activeRooms[socket.data.currentRoomId].host = null;
                //console.log(`Roomid: ${socket.data.currentRoomId} Host ${socket.id} left. Migrating host...`);
                
                const remainingUserIds = Object.keys(activeRooms[socket.data.currentRoomId].users);

                if (remainingUserIds.length > 0) {
                    let newHostId = remainingUserIds[0];
                    for(const id of remainingUserIds){
                        if(activeRooms[socket.data.currentRoomId].users[id].role === 'admin'){
                            newHostId = id;
                            break;
                        }
                    }

                    activeRooms[socket.data.currentRoomId].users[newHostId].role = 'host';
                    activeRooms[socket.data.currentRoomId].host = newHostId;
                    
                    io.to(socket.data.currentRoomId).emit('switch-permission', newHostId, null, 'host');
                    io.to(socket.data.currentRoomId).emit('update-user-list', activeRooms[socket.data.currentRoomId].users);
                    //console.log(`Roomid: ${socket.data.currentRoomId} User ${newHostId} promoted to Host.`);
                }
            }

            setTimeout(() => { 
                if (!activeRooms[roomToCleanup]) return;

                const currentSize = io.sockets.adapter.rooms.get(roomToCleanup)?.size || 0; 

                if (currentSize === 0) {
                    delete activeRooms[roomToCleanup]; 
                    //console.log(`Room ${roomToCleanup} deleted because it is empty.`);
                }
            }, 5000);
        }
    });
};
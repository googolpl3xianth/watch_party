const io = require('socket.io')(3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const creationSpamFilter = new Map();

const activeRooms = {}; // Memory to store { roomId: { video_name, time, isPaused, users: [{socket.id, username, permision}] } }

const fs = require('fs');
const path = require('path');
function getVideoList(dir = '/videos', allFiles = []) {
    try {
        const files = fs.readdirSync(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            
            if (file.isDirectory()) {
                getVideoList(fullPath, allFiles);
            } else {
                if (file.name === 'master.m3u8') {
                    const folderName = path.basename(path.dirname(fullPath));
                    const relativePath = path.posix.join(folderName, 'master.m3u8');
                    allFiles.push(relativePath);
                }
            }
        }
        return allFiles;
    } catch (err) {
        console.error("Recursive search error:", err);
        return allFiles;
    }
}

io.on('connection', (socket) => {
    let currentRoomId = null;

    const list = getVideoList();
    console.log(`Sending recursive list: ${list}`);
    socket.emit('video-list', list);

    socket.on('request-create-room', () => {
        const userIp = socket.handshake.headers['x-real-ip'] || socket.handshake.address;
        const now = Date.now();

        if (creationSpamFilter.has(userIp) && (now - creationSpamFilter.get(userIp) < 15000)) {
            console.log(`Spam blocked from IP: ${userIp}`);
            return socket.emit('join-error', 'Please wait 15 seconds before creating another room.');
        }

        creationSpamFilter.set(userIp, now);

        const newID = Math.random().toString(36).substring(2, 8);
        activeRooms[newID] = {currentTime: 0, isPaused: true, host: null, users: {}, bufferingUsers: new Set()};

        console.log(`Room created: ${newID} by host: ${socket.id}`);
        socket.emit('room-created', newID);
    });

    socket.on('join-room', (roomId) => {
        if (activeRooms[roomId]) {
            socket.join(roomId);
            currentRoomId = roomId;

            let role = 'guest';
            const users = activeRooms[roomId].users;

            if(!(socket.id in users)){
                if(!activeRooms[roomId].host){
                    role = 'host';
                    activeRooms[roomId].host = socket.id;
                    console.log(`Roomid: ${currentRoomId} ${socket.id} promoted to Host`);
                }
                users[socket.id] = {
                    role: role,
                    username:`User-${socket.id.substring(0, 4)}`
                };
            }
            console.log(`Roomid: ${currentRoomId} User Joined: ${socket.id}`);
            socket.emit('join-success', users[socket.id].role);
            io.to(roomId).emit('update-user-list', activeRooms[currentRoomId].users);
        } else {
            socket.emit('join-error', 'This room does not exist or has expired.');
        }
    });

    socket.on('request-video-change', (filename) => {
        if (!currentRoomId || !activeRooms[currentRoomId]) return;
        activeRooms[currentRoomId].video_name = filename;
        io.to(currentRoomId).emit('load-new-video', filename);
    });

    socket.on('request-load-video', () => {
        if (!currentRoomId || !activeRooms[currentRoomId]) return;
        if (activeRooms[currentRoomId].video_name) {
            console.log(`Sending current video to late joiner in ${currentRoomId}`);
            socket.emit('load-new-video', activeRooms[currentRoomId].video_name);
        }
    });

    socket.on('request-sync', () => {
        const room = activeRooms[currentRoomId];
        
        if (room && room.host) {
            if(socket.id !== room.host){
                socket.to(room.host).emit('get-video-status', { requesterId: socket.id });
            }
        }
    });

    socket.on('host-video-status', (data) => {
        if (activeRooms[currentRoomId]) {
            activeRooms[currentRoomId].isPaused = data.paused;
            activeRooms[currentRoomId].currentTime = data.time;
            socket.to(data.requesterId).emit('apply-sync', {
                type: activeRooms[currentRoomId].isPaused ? 'pause' : 'play',
                time: activeRooms[currentRoomId].currentTime
            });
        }
    });

    socket.on('sync-event', (data) => {
        if (!currentRoomId || !activeRooms[currentRoomId]) return;

        const userRole = activeRooms[currentRoomId].users[socket.id].role;
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

    socket.on('client-buffering', () => {
        if (currentRoomId && activeRooms[currentRoomId]) {
            activeRooms[currentRoomId].bufferingUsers.add(socket.id);
            console.log(`Room ${currentRoomId}: User ${socket.id} is buffering. Pausing room.`);
            if (!activeRooms[currentRoomId].isPaused) {
                socket.to(currentRoomId).emit('force-pause-room', socket.id);
            }
        }
    });

    socket.on('client-recovered', () => {
        if (currentRoomId && activeRooms[currentRoomId]) {
            activeRooms[currentRoomId].bufferingUsers.delete(socket.id);
            console.log(`Room ${currentRoomId}: User ${socket.id} recovered. Resuming room.`);
            if (activeRooms[currentRoomId].bufferingUsers.size === 0 && !activeRooms[currentRoomId].isPaused) {
                socket.to(currentRoomId).emit('resume-room');
            }
        }
    });

    socket.on('request-user-change', (targetID, targetUsername, targetRole) => {
        if (!currentRoomId || !activeRooms[currentRoomId]) return;

        const requesterRole = activeRooms[currentRoomId].users[socket.id].role;
        const finalID = targetID || socket.id; 

        if (targetRole || (targetID && targetID !== socket.id)) {
            if (requesterRole !== 'host' && requesterRole !== 'admin') {
                console.log(`Exploit blocked: Guest ${socket.id} tried to change roles/users.`);
                return; 
            } 
            else if(targetID && targetID !== socket.id && requesterRole === 'admin' && activeRooms[currentRoomId].users[finalID].role === 'host'){
                console.log(`Exploit blocked: Admin ${socket.id} tried to change roles/users of host.`);
                return; 
            }
        }
        
        if (finalID && activeRooms[currentRoomId] && activeRooms[currentRoomId].users[finalID]) {
            const remainingUserIds = Object.keys(activeRooms[currentRoomId].users);
            if(targetRole === 'host'){
                activeRooms[currentRoomId].users[activeRooms[currentRoomId].host].role = 'admin';
                io.to(currentRoomId).emit('switch-permission', activeRooms[currentRoomId].host, null, 'admin');
                activeRooms[currentRoomId].host = finalID;
            }
            else if(activeRooms[currentRoomId].users[finalID].role === 'host' && (remainingUserIds.length > 1)){
                let newHostId = remainingUserIds[0];
                for(const id of remainingUserIds){
                    if(activeRooms[currentRoomId].users[id].role === 'admin'){
                        newHostId = id;
                        break;
                    }
                    else if(id != finalID){
                        newHostId = id;
                    }
                }
                activeRooms[currentRoomId].host = newHostId;
                activeRooms[currentRoomId].users[newHostId].role = 'host';
                io.to(currentRoomId).emit('switch-permission', newHostId, null, 'host');
            }
            if (targetUsername) {
                activeRooms[currentRoomId].users[finalID].username = targetUsername;
            }
            if (targetRole && (remainingUserIds.length > 1)) {
                activeRooms[currentRoomId].users[finalID].role = targetRole;
            }
            
            console.log(`Server successfully updated ${finalID} to role: ${targetRole}`);
            
            io.to(currentRoomId).emit('switch-permission', finalID, targetUsername, targetRole);
            io.to(currentRoomId).emit('update-user-list', activeRooms[currentRoomId].users);
        }
    });

    socket.on('disconnect', () => {
        const roomToCleanup = currentRoomId;
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
                activeRooms[currentRoomId].host = null;
                console.log(`Roomid: ${currentRoomId} Host ${socket.id} left. Migrating host...`);
                
                const remainingUserIds = Object.keys(activeRooms[currentRoomId].users);

                if (remainingUserIds.length > 0) {
                    let newHostId = remainingUserIds[0];
                    for(const id of remainingUserIds){
                        if(activeRooms[currentRoomId].users[id].role === 'admin'){
                            newHostId = id;
                            break;
                        }
                    }

                    activeRooms[currentRoomId].users[newHostId].role = 'host';
                    activeRooms[currentRoomId].host = newHostId;
                    
                    io.to(currentRoomId).emit('switch-permission', newHostId, null, 'host');
                    io.to(currentRoomId).emit('update-user-list', activeRooms[currentRoomId].users);
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
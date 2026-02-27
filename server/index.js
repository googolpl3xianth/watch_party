const io = require('socket.io')(3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const activeRooms = {}; // Memory to store { roomId: { video_name, time, isPaused, users: {username, permisionlv} } }

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
            console.log(`Roomid: ${currentRoomId} User Joined: ${socket.id}`);
            socket.emit('join-success', users[socket.id]);
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
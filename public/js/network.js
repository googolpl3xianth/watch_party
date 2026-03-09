// js/network.js
import { State } from './state.js';
import { setupVideo, handleApplySync, getVideoData, bufferPause, bufferPlay } from './video.js';
import { showRoom, showGate, showRoomStatus, showPermOnly, setVideoSelect, updateUserCount, updateUserList, removeUser, getSelectedVideo, setupLobbyUI} from './ui.js';

export const socket = io({secure: true, transports: ['websocket'] });

const roomId = State.roomId;
let logicInitialized = false;
let lastOutboundTime = 0;

export function initializeNetwork(){
    setupSocketUI();

    socket.on('room-created', (newId) => {
        window.location.search = `?room=${newId}`;
    });

    socket.on('join-success', (permission) => {
        document.documentElement.classList.remove('direct-join');
        showRoom();

        State.isHost = (permission === 'host');
        State.sync_perm = (permission === 'host' || permission === 'admin');

        showPermOnly();
        //console.log("Reqesting to load video");
        socket.emit('request-load-video');
        setupSocketLogic(socket); 
    });

    socket.on('join-error', (msg) => {
        const errorText = document.getElementById('error-message');
        if (errorText) {
            errorText.innerText = msg;
            errorText.style.display = 'block';
        }
        window.history.pushState({}, document.title, window.location.pathname);

        setupLobbyUI();
    });
}

function setupSocketUI(){
    socket.on('video-list', (files) => {
        setVideoSelect(files);
    });

    socket.on('get-video-status', (data) =>{
        let videodata = getVideoData();
        socket.emit('host-video-status', {
            requesterId: data.requesterId, 
            time: videodata.currentTime,
            paused: videodata.paused
        });
    })

    socket.on('update-user-list', (usersData) => {
        if (!usersData) return;

        State.usersArray = usersData;

        updateUserCount();

        const activeSocketIds = new Set();

        for (const [socketId, userDetails] of Object.entries(State.usersArray)) {
            activeSocketIds.add(socketId); 
            
            const targetName = userDetails.username || 'Guest';
            const targetRole = userDetails.role || 'guest';

            updateUserList(socketId, targetName, targetRole);
        };
    });

    socket.on('user-left', (disconnectedSocketId) => {
        removeUser(disconnectedSocketId);
    });
}

function setupSocketLogic() {
    if (logicInitialized) {
        // Update the internal permission variable if your logic uses one
        return; 
    }
    logicInitialized = true;

    // --- 2. INBOUND: Everyone ---
    socket.on('load-new-video', (filename) => {
        if (State.currentVideoFilename === filename || !filename) return;
        showRoomStatus();
        State.currentVideoFilename = filename;
        //console.log("Switching to:", filename);

        if (!State.hasJoined) {
            showGate();
        }

        setupVideo(filename);
    });

    socket.on('switch-permission', (targetSocketID, newUsername, newRole) => {
        //console.log("Received switch-permission from server for:", targetSocketID, newRole);
        if(!targetSocketID) { targetSocketID = socket.id; }
        
        if (State.usersArray[targetSocketID]) {
            if (newUsername) State.usersArray[targetSocketID].username = newUsername;
            if (newRole) State.usersArray[targetSocketID].role = newRole;
            updateUserList(targetSocketID, newUsername, newRole);
        }
    });

    socket.on('apply-sync', (data) => {
        const now = Date.now();
        if (now - lastOutboundTime < 500 && data.type === 'heartbeat') return;
        if (now - lastOutboundTime < 200) return; // Minimum "cool down" to prevent loops

        handleApplySync(data);
    });

    socket.on('force-pause-room', (bufferingUserId) => {
        //console.log(`User ${bufferingUserId} is buffering. Auto-pausing...`);
        bufferPause();
    });

    socket.on('resume-room', () => {
        //console.log("Everyone caught up. Auto-resuming...");
        bufferPlay();
    });
}

// Room logic
export function createRoom() {
    socket.emit('request-create-room');
}

export function joinRoom(){
    socket.emit('join-room', roomId);
}

export function checkSubtitles(filename, callback) {
    socket.emit('check-subtitles', filename, callback);
}

// UI logic
export function requestChange(filename) {
    const selectedFile = filename || getSelectedVideo();
    if (selectedFile) {
        socket.emit('request-video-change', selectedFile);
    }
}

export function updateUser(targetId=null, username=null, role=null){
    socket.emit('request-user-change', targetId, username, role);
}

// Video logic
export function sync(){
    socket.emit('request-sync');
}

export function emitSync(type, time){
    if (!State.sync_perm) return;
    lastOutboundTime = Date.now();
    socket.emit('sync-event', { type, time });
}

// Buffer logic
export function clientBuffering(){
    socket.emit('client-buffering');
}

export function clientRecovered(){
    socket.emit('client-recovered');
}
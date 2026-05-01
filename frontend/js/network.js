// js/network.js
import { State } from './state.js';
import { setupVideo, executeSync, getVideoData, reloadVideo, changeQuality, isSettingUpVideo } from './video.js';
import { showRoom, showGate, hideRoomStatus, showPermOnly, setVideoSelect, updateUserCount, updateUserList, removeUser, getSelectedVideo, setupLobbyUI, changeRoomStatus} from './ui.js';

export const socket = io({secure: true, transports: ['websocket'] });

const roomId = State.roomId;
let logicInitialized = false;
let fakeProgressBar = null;

export function initializeNetwork(){
    setupSocketUI();

    socket.on('room-created', (newId) => {
        window.location.search = `?room=${newId}`;
    });

    socket.on('join-success', (data) => {
        let permission = data.role;
        if (permission === 'host') {
            sessionStorage.setItem('watchPartyHostToken', State.roomId);
        }
        State.targetQuality = data.quality;
        State.p2pThreshold = data.p2pThreshold;

        State.isHost = (permission === 'host');
        State.sync_perm = (permission === 'host' || permission === 'admin');

        document.documentElement.classList.remove('direct-join');
        showRoom();
        socket.emit('update-video-list');

        showPermOnly(permission);
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

    socket.on('connect', () => {
        if (State.hasJoined && roomId) {
            //console.log("[NETWORK] Reconnected to server! Re-joining room...");
            socket.emit('join-room', roomId);
        }
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

        const oldUserCount = State.usersArray ? Object.keys(State.usersArray).length : 0;

        State.usersArray = usersData;
        const newUserCount = Object.keys(State.usersArray).length;

        updateUserCount();

        const activeSocketIds = new Set();

        for (const [socketId, userDetails] of Object.entries(State.usersArray)) {
            activeSocketIds.add(socketId); 
            
            const targetName = userDetails.username || 'Guest';
            const targetRole = userDetails.role || 'guest';
              
            updateUserList(socketId, targetName, targetRole);
        };

        if (oldUserCount > 0 && oldUserCount < State.p2pThreshold && newUserCount >= State.p2pThreshold) {
            if (!isSettingUpVideo) {
                reloadVideo(); 
            }
        }
    });

    socket.on('user-left', (disconnectedSocketId) => {
        removeUser(disconnectedSocketId);
    });
}

function setupSocketLogic() {
    let localBufferingList = new Set();
    if (logicInitialized) {
        // Update the internal permission variable if your logic uses one
        return; 
    }
    logicInitialized = true;
    
    socket.on('load-new-video', (filename) => {
        if (State.currentVideoFilename === filename || !filename) return;
        hideRoomStatus();
        State.currentVideoFilename = filename;
        //console.log("Switching to:", filename);

        if (!State.hasJoined) {
            showGate();
        }

        setupVideo(filename);
    });

    socket.on('transcode-start', () => {
        changeRoomStatus(`Analyzing video formatting...`);
    });

    socket.on('transcode-progress', (percentage) => {
        if (percentage >= 100) {
            changeRoomStatus(`Generating thumbnails and finalizing...`);
        } else {
            changeRoomStatus(`Transcoding... ${percentage}%`);
        }
    });

    socket.on('transcode-ready', (finalPath) => {
        changeRoomStatus(`Transcoding Complete! Loading...`);
        setTimeout(() => {
            hideRoomStatus();
        }, 1000); 
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

    socket.on('apply-quality', (levelIndex) => {
        changeQuality(levelIndex);
    });

    socket.on('bufferingList', (bufferingList) => {
        bufferingList = new Set(bufferingList);
    
        let removed = localBufferingList.difference(bufferingList);
        let added = bufferingList.difference(localBufferingList);
        localBufferingList = bufferingList;

        for(const id of removed){
            updateUserList(id, null, null, false);
        }
        for(const id of added){
            updateUserList(id, null, null, true)
        }
    });

    socket.on('apply-sync', (data) => {
        executeSync(data);
    });
}

// Room logic
export function createRoom() {
    socket.emit('request-create-room');
}

export function joinRoom(){
    const token = sessionStorage.getItem('watchPartyHostToken');
    const savedName = localStorage.getItem('watchPartyUsername') || null;

    socket.emit('join-room', {roomId, hostToken: token, username: savedName});
}

export function checkSubtitles(filename, callback) {
    socket.emit('check-subtitles', filename, callback);
}

// UI logic
export function requestChange(filename) {
    //console.log(`requested change to ${filename}`);
    if(filename){
        socket.emit('update-video-list');
    }
    const selectedFile = filename || getSelectedVideo();
    if (selectedFile) {
        socket.emit('request-video-change', selectedFile);
    }
}

export function updateUser(targetId=null, username=null, role=null){
    socket.emit('request-user-change', targetId, username, role);
}

export function updateP2PStatus(P2PStatus){
    socket.emit('update-p2p-status', P2PStatus);
}

// Video logic
export function sync(){
    socket.emit('request-sync');
}

export function emitSync(type, time){
    if (!State.sync_perm) return;
    socket.emit('sync-event', { type, time });
}

export function emitQualityChange(qualityLevel){
    if (!State.sync_perm) return;
    socket.emit('host-quality-change', qualityLevel)
}

// Buffer logic
export function clientBuffering(){
    socket.emit('client-buffering');
}

export function clientRecovered(){
    socket.emit('client-recovered');
}

// js/ui.js
import { State } from './state.js';
import { socket, createRoom, requestChange, updateUser} from './network.js'
import { joinVideo } from './video.js'
import { pingWorker } from './upload.js'

const roomCodeInput = document.getElementById('room-code-input');
const lobbyDiv = document.getElementById('lobby');
const roomDiv = document.getElementById('room-interface');
const usernameHeader = document.getElementById('username');
const videoSelect = document.getElementById('video-select');
const userList = document.getElementById('user-list');
const userMenu = document.getElementById('userMenu');
const userCountText = document.getElementById('user-count-text');
const roleMenu = document.getElementById('role-menu');
const roomStatus = document.getElementById('room-status');
const joinGate = document.getElementById('join-gate');
const joinBtn = document.getElementById('join-btn');
const uploadArea = document.getElementById('upload-area');
const uploadBtn = document.getElementById('open-upload-modal-btn')

export function setupLobbyUI(){
    document.getElementById('page-loader').style.display = 'none';
    document.documentElement.classList.remove('direct-join');

    lobbyDiv.style.display = 'flex';
    roomDiv.style.display = 'none';

    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-room-btn').addEventListener('click', joinManualRoom);

    if (roomCodeInput) {
        roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') joinManualRoom();
        });
    }
}

export function setupRoomUI() {
    const userCountBtn = document.getElementById('user-count-btn');

    document.getElementById('get-room-link-btn').addEventListener('click', getRoomLink);
    document.getElementById('edit-name-btn').addEventListener('click', rename);
    document.getElementById('home-btn').addEventListener('click', goHome);
    document.getElementById('load-video-btn').addEventListener('click', () => requestChange());
    uploadBtn.addEventListener('click', openUpload);

    userCountBtn.addEventListener('click', getUserList);
    document.getElementById('change-role-btn').addEventListener('click', (event) => {getRoleList(event)});
    document.getElementById('role-change-host').addEventListener('click', () => {submitRoleChange('host')});
    document.getElementById('role-change-admin').addEventListener('click', () => {submitRoleChange('admin')});
    document.getElementById('role-change-guest').addEventListener('click', () => {submitRoleChange('guest')});
    document.getElementById('rename-btn').addEventListener('click', rename);

    joinBtn.onclick = async () => {
        State.hasJoined = true;	
        joinGate.style.display = 'none';
        joinVideo();
    };

    // Contextmenu
    userList.addEventListener('contextmenu', (e) => {
        if (e.target.classList.contains('user-item')) {
            e.preventDefault(); 
            
            const targetSocketId = e.target.getAttribute('data-id');
            userMenu.setAttribute('data-target-id', targetSocketId);

            const renameBtn = document.getElementById('rename-btn');
            const changeRoleBtn = document.getElementById('change-role-btn');
            if (targetSocketId === socket.id || State.sync_perm) {
                renameBtn.style.display = 'block';
            } else {
                renameBtn.style.display = 'none';
            }
            if ((targetSocketId === socket.id && State.sync_perm) || State.isHost) {
                //console.log(`${isHost}`);
                changeRoleBtn.style.display = 'block';
            } else {
                changeRoleBtn.style.display = 'none';
                //console.log(`${changeRoleBtn.style.display}`);
            }

            userMenu.classList.add('visible');

            const menuWidth = userMenu.offsetWidth;
            const menuHeight = userMenu.offsetHeight;

            let posX = e.clientX;
            let posY = e.clientY;

            if (posX + menuWidth > window.innerWidth) {
                posX = posX - menuWidth;
            }

            if (posY + menuHeight > window.innerHeight) {
                posY = posY - menuHeight;
            }

            userMenu.style.left = `${posX}px`;
            userMenu.style.top = `${posY}px`;
        }
    });

    document.addEventListener('click', (e) => {
        if (!userMenu.contains(e.target)) {
            userMenu.classList.remove('visible');
            roleMenu.style.display = 'none';
            if(!userCountBtn.contains(e.target) && !userList.contains(e.target) && userList.style.display === 'block'){
                userList.style.display = 'none';
            }
        }
    });
}

export function showRoom(){
    document.getElementById('page-loader').style.display = 'none';

    const roomDisplay = document.getElementById('room-display');

    lobbyDiv.style.display = 'none';
    roomDiv.style.display = 'block';
    roomDisplay.innerText = `Room ID: ${State.roomId}`;
}

export function setVideoSelect(files){
    videoSelect.innerHTML = '<option value="">-- Select a Video --</option>';

    const groupedVideos = {};
    const uncategorizedVideos = [];

    const uniqueFiles = [...new Set(files)];

    files.forEach(file => {
        const parts = file.split('/');
        
        if (parts.length >= 3) {
            const seriesName = parts[0]; 

            let displayName = parts.slice(1).join(' / ');
            displayName = displayName.replace('/master.m3u8', '').replace('master.m3u8', 'Video File');
            
            if (!groupedVideos[seriesName]) {
                groupedVideos[seriesName] = [];
            }
            groupedVideos[seriesName].push({ path: file, name: displayName });
        } else {
            uncategorizedVideos.push({ path: file, name: file });
        }
    });

    const sortedSeriesNames = Object.keys(groupedVideos).sort((a, b) => a.localeCompare(b));

    for (const series of sortedSeriesNames) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = series;

        const videos = groupedVideos[series].sort((a, b) => a.name.localeCompare(b.name));

        videos.forEach(video => {
            const option = document.createElement('option');
            option.value = video.path;
            option.textContent = video.name;
            optgroup.appendChild(option);
        });

        videoSelect.appendChild(optgroup);
    }

    if (uncategorizedVideos.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = "Other Uploads";
        
        uncategorizedVideos.sort((a, b) => a.name.localeCompare(b.name)).forEach(video => {
            const option = document.createElement('option');
            option.value = video.path;
            option.textContent = video.name;
            optgroup.appendChild(option);
        });
        videoSelect.appendChild(optgroup);
    }
}

export function getSelectedVideo(){
    return videoSelect.value;
}

export function showRoomStatus(){
    roomStatus.style.display = 'block';
}

export function hideRoomStatus(){
    roomStatus.style.display = 'none';
}

export function changeRoomStatus(text){
    showRoomStatus();
    roomStatus.innerText = text;
}

export function updateUserCount(){
    let tempList = Object.entries(State.usersArray);
    if(tempList.length > 99){
        userCountText.innerText = `99+`;
    }
    else{
        userCountText.innerText = `${tempList.length}`;
    }
}

export function updateUserList(socketId, username, role, buffering=null){
    username = username || State.usersArray[socketId].username;
    role = role || State.usersArray[socketId].role;

    const inSwarm = State.usersArray[socketId].inSwarm || false; 
    const currentUserCount = Object.keys(State.usersArray || {}).length;

    let displayText = `${username} (${role})`;
    if(socketId === socket.id){ 
        displayText += ' *'; 
        usernameHeader.innerText = `Name: ${username}`;

        const myConfirmedRole = State.usersArray[socketId].role;
        State.isHost = (myConfirmedRole === 'host');
        State.sync_perm = (myConfirmedRole === 'host' || myConfirmedRole === 'admin');
        
        showPermOnly();
    }

    let userDiv = userList.querySelector(`.user-item[data-id="${socketId}"]`);
    
    if (userDiv) {
        let textSpan = userDiv.querySelector('.user-text');
        if (textSpan) {
            textSpan.innerText = displayText;
        }

        if(buffering !== null){
            let bufferIndicator = userDiv.querySelector(`.loader`);
            if(bufferIndicator){
                if(buffering === false){
                    bufferIndicator.style.display = 'none'
                }
                else if(buffering === true){
                    bufferIndicator.style.display = 'flex'
                }
            }
        }
    } else {
        userDiv = document.createElement('div');
        userDiv.classList.add('user-item'); 
        userDiv.dataset.id = socketId; 
        userDiv.style.cursor = "default";

        let textSpan = document.createElement('span');
        textSpan.classList.add('user-text');
        textSpan.innerText = displayText;
        userDiv.appendChild(textSpan);

        let bufferIndicator = document.createElement('span');
        bufferIndicator.classList.add('loader');
        bufferIndicator.style.display = 'none';
        bufferIndicator.style.position = 'default';
        userDiv.appendChild(bufferIndicator);

        userList.appendChild(userDiv);
    }

    let badge = userDiv.querySelector('.swarm-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.classList.add('swarm-badge');
        badge.style.marginLeft = '10px';
        badge.style.fontSize = '0.85em';
        badge.style.fontWeight = 'bold';
        userDiv.appendChild(badge);
    }

    if (currentUserCount >= State.p2pThreshold) {
        badge.style.display = 'inline';
        if (inSwarm) {
            badge.textContent = '🌐 Swarm';
            badge.style.color = '#00ff00';
        } else {
            badge.textContent = '☁️ Server';
            badge.style.color = '#aaaaaa';
        }
    } else {
        badge.style.display = 'none';
    }
}

export function removeUser(disconnectedSocketId){
    const ghostElement = userList.querySelector(`.user-item[data-id="${disconnectedSocketId}"]`);
        
        if (ghostElement) {
            ghostElement.remove();
            const currentCount = parseInt(userCountText.innerText.replace('+', '')) - 1;
            if(currentCount > 99){
                userCountText.innerText = `99+`;
            }
            else{
                userCountText.innerText = `${currentCount}`;
            }
        }
}

export function showGate(){
    joinGate.style.display = 'flex';
    joinBtn.style.display = 'flex';
}

export function showPermOnly(forceRole = null){
    const hostElements = document.querySelectorAll('.host-only');
    const permElements = document.querySelectorAll('.perms-only');
    const guestElements = document.querySelectorAll('.guest-only');

    if (forceRole) {
        State.isHost = (forceRole === 'host');
        State.sync_perm = (forceRole === 'host' || forceRole === 'admin');
    } else if (State.usersArray[socket.id]) {
        const myConfirmedRole = State.usersArray[socket.id].role;
        State.isHost = (myConfirmedRole === 'host');
        State.sync_perm = (myConfirmedRole === 'host' || myConfirmedRole === 'admin');
    }


    if (State.sync_perm) {
        if(State.isHost){
            hostElements.forEach(el => el.classList.add('show-host'));
        }
        else{
            hostElements.forEach(el => el.classList.remove('show-host'));
        }
        guestElements.forEach(el => el.classList.remove('show-guest'));
        permElements.forEach(el => el.classList.add('show-perms'));
    } else {
        hostElements.forEach(el => el.classList.remove('show-host'));
        guestElements.forEach(el => el.classList.add('show-guest'));
        permElements.forEach(el => el.classList.remove('show-perms'));
    }

    const qualitySelector = document.getElementById('quality-selector');
    if (qualitySelector) {
        qualitySelector.disabled = !State.sync_perm; 
    }
}

function goHome() {
    window.location.search = "";
}

function joinManualRoom(){
    const input = document.getElementById('room-code-input');
    const code = input.value.trim().toLowerCase(); 
    
    if (code.length > 0) {
        window.location.search = `?room=${code}`;
    } else {
        input.style.borderColor = "red";
        setTimeout(() => input.style.borderColor = "#333", 1000);
    }
}

function getRoomLink(){
    const text = document.URL;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
        .then(() => {
            //console.log('Text copied to clipboard successfully!');
        })
        .catch(err => {
            console.error('Could not copy text: ', err);
        });
    } else {
        console.error('Clipboard API not supported');
    }
}

function openUpload(){
    if(pingWorker()){
        uploadBtn.style.opacity = "1";
        uploadArea.style.display = "default";
    }
    else{
        uploadBtn.style.opacity = "0.5";
    }
}

function rename(){
    let username = window.prompt("What's your username?");
    if (username) {
        usernameHeader.innerText = `Name: ${username}`;
        updateUser(socket.id, username, null);
        localStorage.setItem('watchPartyUsername', username);
    }
    userMenu.classList.remove('visible');
}

function getUserList() {
    if (userList.style.display === 'block') {
        userList.style.display = 'none';
    } else {
        userList.style.display = 'block';
    }
}

function getRoleList(e) {
    e.stopPropagation();
    if (roleMenu.style.display === 'block') {
        roleMenu.style.display = 'none';
    } else {
        roleMenu.style.display = 'block';
    }
}

function submitRoleChange(newRole) {
    const targetId = userMenu.getAttribute('data-target-id'); 
    
    //console.log("Sending permission change to server for User:", targetId, "New Role:", newRole);
    
    updateUser(targetId, null, newRole);
    
    roleMenu.style.display = 'none';
    userMenu.classList.remove('visible');
}

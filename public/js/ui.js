// js/ui.js
import { State } from './state.js';
import { socket, createRoom, requestChange, updateUser} from './network.js'
import { joinVideo, allowProgressAccess } from './video.js'

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
    document.getElementById('load-video-btn').addEventListener('click', requestChange);

    document.getElementById('user-count-btn').addEventListener('click', getUserList);
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
    videoSelect.innerHTML = '<option value="">-- Select a Video --</option>'; // Reset
    files.forEach(file => {
        const option = document.createElement('option');
        option.value = file;
        option.textContent = file;
        videoSelect.appendChild(option);
    });
}

export function getSelectedVideo(){
    return videoSelect.value;
}

export function showRoomStatus(){
    roomStatus.classList.remove('show-guest');
    roomStatus.style.setProperty('display', 'none', 'important');
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

export function updateUserList(socketId, username, role){
    username = username || State.usersArray[socketId].username;
    role = role || State.usersArray[socketId].role;
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
        userDiv.innerText = displayText;
    } else {
        userDiv = document.createElement('div');
        userDiv.classList.add('user-item'); 
        userDiv.dataset.id = socketId; 
        userDiv.innerText = displayText; 
        
        userDiv.style.cursor = "default";

        userList.appendChild(userDiv);
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

export function showPermOnly(){
    const hostElements = document.querySelectorAll('.host-only');
    const permElements = document.querySelectorAll('.perms-only');
    const guestElements = document.querySelectorAll('.guest-only');

    if(State.usersArray[socket.id]){
        const myConfirmedRole = State.usersArray[socket.id].role;
        State.isHost = (myConfirmedRole === 'host');
        State.sync_perm = (myConfirmedRole === 'host' || myConfirmedRole === 'admin');
    }
    
    if(State.isHost){
        hostElements.forEach(el => {
            el.classList.add('show-host');
            el.style.setProperty('display', 'block', 'important');
        });
    }
    else{
        hostElements.forEach(el => {
            el.classList.remove('show-host');
            el.style.setProperty('display', 'none', 'important');
        });
    }

    if (State.sync_perm) {
        if(State.isHost){
            hostElements.forEach(el => {
                el.classList.add('show-host');
                el.style.setProperty('display', 'block', 'important');
            });
        }
        guestElements.forEach(el => {
            el.classList.remove('show-guest');
            el.style.setProperty('display', 'none', 'important');
        });
        permElements.forEach(el => {
            el.classList.add('show-perms');
            el.style.setProperty('display', 'block', 'important');
        });
        allowProgressAccess(true);
    } else {
        guestElements.forEach(el => {
            el.classList.add('show-guest');
            el.style.setProperty('display', 'block', 'important');
        });
        permElements.forEach(el => {
            el.classList.remove('show-perms');
            el.style.setProperty('display', 'none', 'important');
        });
        allowProgressAccess(false);
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

function rename(){
    let username = window.prompt("What's your username?");
    if (username) {
        usernameHeader.innerText = `Name: ${username}`;
        updateUser(socket.id, username, null); // Always update your own name
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
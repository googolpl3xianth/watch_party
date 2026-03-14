// js/state.js
export const State = {
    // URL Params
    roomId: new URLSearchParams(window.location.search).get('room'),
    
    // Application State
    isHost: false,
    sync_perm: false,
    hasJoined: false,
    currentVideoFilename: "",
    usersArray: [],
};
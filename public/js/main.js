// js/main.js
import { State } from './state.js';
import { setupLobbyUI, setupRoomUI } from './ui.js';
import { setupVideoPlayer } from './video.js';
import { initializeNetwork, joinRoom} from './network.js';

initializeNetwork();

if (State.roomId) {
    setupRoomUI();
    setupVideoPlayer();
    joinRoom();
} else {
    setupLobbyUI()
}
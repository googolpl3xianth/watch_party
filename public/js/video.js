// js/video.js
import { State } from './state.js';
import { emitSync, sync, checkSubtitles, clientBuffering, clientRecovered } from './network.js';

const hlsConfig = {
    startLevel: -1,
    capLevelToPlayerSize: true,
    maxBufferLength: 60, 
    maxMaxBufferLength: 90,
    abrEwmaDefaultEstimate: 500000, 
    abrBandWidthFactor: 0.6, 
    maxStarvationDelay: 2,
    enableWorker: true
}
const SYNC_THRESHOLD = 1.5;

let idleTimer;
let hls = null;
let syncLockTimer = null; 
let internalChange = false;
let heartbeatTimer = null;
let heartbeatInterval = 3000;
let pendingPlayListener = null;

const wrapper = document.getElementById('video-wrapper');
const video = document.getElementById('myVideo');
const videoLoader = document.getElementById('video-loader');
const controls = document.querySelector('.video-overlay');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.querySelector('.progress-container');
const timeDisplay = document.getElementById('time-display');
const playPauseIcon = document.getElementById('play-pause-icon');
const ccBtn = document.getElementById('subtitle-btn');
const ccIcon = document.getElementById('cc-icon');
const muteBtn = document.getElementById('mute-icon');

export function setupVideoPlayer() {
    setUpVideoUI();
    video.controls = false;
    let isBufferingLocal = false;
    let wasPlayingBeforeScrub = false;
    let isDragging = false;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
            if (State.sync_perm) {
                togglePlay();
            } else {
                video.pause();
                sync();
            }
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            if (State.sync_perm) {
                togglePlay();
            } else {
                video.pause();
                sync();
            }
        });

        navigator.mediaSession.setActionHandler('seekbackward', () => {
            if (State.sync_perm) {
                video.currentTime -= 5;
                emitSync('seeking', video.currentTime);
            } else sync();
        });

        navigator.mediaSession.setActionHandler('seekforward', () => {
            if (State.sync_perm) {
                video.currentTime += 5;
                emitSync('seeking', video.currentTime);
            } else sync();
        });
    }

    video.addEventListener('timeupdate', () => {
        if (isDragging) return;
        if (video.duration) {
            const percentage = (video.currentTime / video.duration) * 100;
            progressBar.style.width = percentage + '%';

            const current = formatTime(video.currentTime);
            const total = formatTime(video.duration);
            timeDisplay.innerText = `${current} / ${total}`;
        }
    });

    window.addEventListener('keydown', (e) => {
        if ([" ", "ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
        }

        if(State.sync_perm){
            if (e.key === " " || e.code === "Space") {
                togglePlay();
            } else if (e.key === "ArrowRight") {
                video.currentTime += 5; 
                emitSync('seeking', video.currentTime);
            } else if (e.key === "ArrowLeft") {
                video.currentTime -= 5;
                emitSync('seeking', video.currentTime);
            }
        }
        if (e.key === "f"){
            toggleFullscreen();
        }
        else if(e.key === "m"){
            toggleMute();
        }
        else if(e.key === "c"){
            toggleSubtitles();
        }
    });

    // Buffering logic
    video.addEventListener('waiting', () => {
        if (!isBufferingLocal && video.readyState < 3) {
            isBufferingLocal = true;
            videoLoader.classList.add('visible');
            
            internalChange = true;
            video.pause();
            if (hls) {
                hls.stopLoad(); // Stop downloading chunks
            }
            internalChange = false;

            if (State.hasJoined) clientBuffering();
        }
    });

    function clearBuffering() {
        // If we were buffering, and we now have enough data to play (readyState >= 3)
        if (isBufferingLocal && video.readyState >= 3) {
            isBufferingLocal = false;
            videoLoader.classList.remove('visible');
            if (State.hasJoined) clientRecovered();
        }
    }

    video.addEventListener('canplay', clearBuffering);
    video.addEventListener('playing', clearBuffering);
    video.addEventListener('seeked', clearBuffering);

    video.addEventListener('play', () => {
        playPauseIcon.src = "./img/pause.svg";
        playPauseIcon.alt = "pause";
    });
    video.addEventListener('pause', () => {
        playPauseIcon.src = "./img/play.svg";
        playPauseIcon.alt = "play";
    });

    // --- 1. OUTBOUND: Host Interaction ---
    video.addEventListener('play', () => {
        if (internalChange) return;
        if (!State.sync_perm) { 
            internalChange = true;
            video.pause();
            internalChange = false;

            if (syncLockTimer) clearTimeout(syncLockTimer);
            syncLockTimer = setTimeout(() => { 
                internalChange = true;
                video.pause(); 
                internalChange = false; 
            }, 150);
            
            sync(); 
            return;
        }
        emitSync('play', video.currentTime);
    });

    video.addEventListener('pause', () => {
        if (internalChange) return;
        if (!State.sync_perm) { 
            sync(); 
            return;
        }
        emitSync('pause', video.currentTime);
    });

    video.addEventListener('seeked', () => {
        if (internalChange) return; 
        if (isDragging) return;
        if (!State.sync_perm) { sync(); }
        else emitSync('seeked', video.currentTime);
    });

    progressContainer.addEventListener('mousedown', (e) => {
        if(!State.sync_perm) return;
        isDragging = true;
        wasPlayingBeforeScrub = !video.paused;

        internalChange = true;
        video.pause();
        internalChange = false;

        sync();
        updateVisualScrub(e);
    });

    window.addEventListener('mouseup', (e) => {
        if (State.sync_perm && isDragging) {
            isDragging = false;
            
            const rect = progressContainer.getBoundingClientRect();
            let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width)); 
            const finalTime = (x / rect.width) * video.duration;
            
            if (!isNaN(finalTime)) {
                internalChange = true;
                video.currentTime = finalTime;
                
                video.addEventListener('seeked', () => { 
                    internalChange = false; 
                    if(wasPlayingBeforeScrub) {
                        emitSync('play', video.currentTime);
                    } else {
                        emitSync('pause', video.currentTime);
                    }
                }, {once: true});
            }
        }
    });
    window.addEventListener('mousemove', (e) => {
        if (State.sync_perm && isDragging){
            updateVisualScrub(e); 
        }
    });

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        if (State.isHost && !video.paused && !internalChange) {
            emitSync('heartbeat', video.currentTime);
        }
    }, heartbeatInterval);

    document.getElementById('volume-slider').addEventListener('input', (e) => {
        video.volume = e.target.value;
    });

    wrapper.addEventListener('mousemove', resetIdleTimer);
    wrapper.addEventListener('mousedown', resetIdleTimer);
    wrapper.addEventListener('keydown', resetIdleTimer);
    
    wrapper.addEventListener('fullscreenchange', resetIdleTimer);
    wrapper.addEventListener('webkitfullscreenchange', resetIdleTimer);
}

export function setUpVideoUI(){
    document.getElementById('screen-play-btn').addEventListener('click', togglePlay);
    document.getElementById('play-pause-btn').addEventListener('click', togglePlay);
    document.getElementById('sync-btn').addEventListener('click', sync);
    document.getElementById('mute-btn').addEventListener('click', toggleMute);
    document.getElementById('subtitle-btn').addEventListener('click', toggleSubtitles);
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
}

export function joinVideo(){
    wrapper.style.display = 'flex';
    video.style.display = 'block';
    controls.style.display = 'flex';

    video.muted = false;
    //console.log("Audio context unlocked safely.");
    
    if (video.currentSrc || video.src) {
        video.play().catch(e => {
            if (e.name !== 'AbortError') {
                //console.log("Unmuted playback blocked. Falling back to muted...");
                video.muted = true;
                video.play().catch(err => console.error("Fallback play failed", err));
            }
        });
    } else {
        //console.log("Waiting for HLS to inject the blob URL...");
    }
    sync();
}

export async function setupVideo(filename) {
    const title = document.getElementById('video-title');

    if (hls) {
        hls.destroy();
        hls = null;
    }
    video.innerHTML = '';
    ccBtn.style.display = 'none'; 

    let webSafePath = filename.split('\\').join('/');
    webSafePath = webSafePath.split('/').map(encodeURIComponent).join('/');
    const videoUrl = `/media/${webSafePath}`;
    const basePath = videoUrl.substring(0, videoUrl.lastIndexOf('/'));

    checkSubtitles(filename, (hasSubtitles) => {
        if (hasSubtitles) {
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = 'English';
            track.srclang = 'en';
            track.src = `${basePath}/subtitles.vtt`;
            track.default = true;
            video.appendChild(track);

            track.addEventListener('load', () => {
                const textTracks = video.textTracks;
                if (textTracks.length > 0) {
                    textTracks[0].mode = 'showing';
                    ccBtn.style.display = 'block';
                    ccBtn.style.color = "#ff0000"; 
                    ccBtn.style.opacity = "1";
                }
            });
        } else {
            //console.log("No subtitles found for this video.");
        }
    });

    if (filename.endsWith('.m3u8')) {
        video.removeAttribute('src'); 

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const savedQuality = localStorage.getItem('hlsQuality');

            if (savedQuality !== null) {
                hlsConfig.startLevel = parseInt(savedQuality);
            }

            hls = new Hls({
                startLevel: hlsConfig.startLevel, 
                capLevelToPlayerSize: hlsConfig.capLevelToPlayerSize,
                maxBufferLength: hlsConfig.maxBufferLength, 
                maxMaxBufferLength: hlsConfig.maxMaxBufferLength,
                abrEwmaDefaultEstimate: hlsConfig.abrEwmaDefaultEstimate, 
                abrBandWidthFactor: hlsConfig.abrBandWidthFactor, 
                maxStarvationDelay: hlsConfig.maxStarvationDelay,
                enableWorker: hlsConfig.enableWorker
            });
            
            hls.loadSource(videoUrl);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                //console.log("HLS Manifest Parsed & Ready");
                const qualitySelector = document.getElementById('quality-selector');
                qualitySelector.style.display = 'inline-block';
                qualitySelector.innerHTML = '<option value="-1" style="color: black;">Auto</option>'; 
                
                hls.levels.forEach((level, index) => {
                    const option = document.createElement('option');
                    option.value = index; 

                    let labelName = `${level.height}p`; // Fallback
                    if (level.width === 1920) labelName = "1080p";
                    else if (level.width === 1280) labelName = "720p";
                    else if (level.width === 854) labelName = "480p";

                    option.textContent = labelName; 
                    option.style.color = 'black'; 
                    qualitySelector.appendChild(option);
                });

                if (savedQuality !== null) {
                    qualitySelector.value = savedQuality;
                    hls.currentLevel = parseInt(savedQuality); 
                }

                qualitySelector.addEventListener('change', (e) => {
                    const newLevel = parseInt(e.target.value);
                    hls.currentLevel = newLevel; 
                    
                    localStorage.setItem('hlsQuality', newLevel);
                    
                    //console.log(newLevel === -1 ? "Quality: Auto" : `Quality forced to: ${hls.levels[newLevel].height}p`);
                });

                if (State.hasJoined) {
                    if (video.currentSrc || video.src) {
                        video.play().catch(e => console.error("HLS Autoplay blocked:", e));
                    }
                }
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
                const activeLevel = hls.levels[data.level];
                const currentHeight = activeLevel.height;
                
                //console.log(`[HLS] Seamlessly switched to: ${currentHeight}p`);

                const qualitySelector = document.getElementById('quality-selector');
                
                if (qualitySelector.value === "-1") {
                    const autoOption = qualitySelector.querySelector('option[value="-1"]');
                    if (autoOption) {
                        autoOption.textContent = `Auto (${currentHeight}p)`;
                    }
                }
            });
            
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.warn("Fatal media error encountered, trying to recover...", data);
                            hls.recoverMediaError(); // Tell HLS.js to flush the buffer and try again
                            break;
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error("Fatal network error encountered", data);
                            hls.startLoad(); // Try to fetch the chunk again
                            break;
                        default:
                            console.error("Unrecoverable fatal error. Destroying player.", data);
                            hls.destroy();
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = videoUrl;
            video.addEventListener('loadedmetadata', function() {
                if (State.hasJoined) video.play().catch(e => console.error("Apple Autoplay blocked:", e));
            }, { once: true });
        }
    } else {
        // --- MP4 LOGIC ---
        video.src = videoUrl;
        video.load(); 
        if (State.hasJoined) {
            video.play().catch(e => {
                if (e.name !== 'AbortError') {
                    //console.log("MP4 Autoplay blocked:", e);
                }
            });
        }
    }
    if(State.currentVideoFilename.endsWith(".m3u8")){
        title.innerText  = State.currentVideoFilename.split('/')[0];
    }
    else{
        title.innerText = State.currentVideoFilename.split('.')[0];
    }
}

export function executeSync(data) {
    const timeDiff = Math.abs(video.currentTime - data.time);
    if (data.type === 'heartbeat' && timeDiff <= SYNC_THRESHOLD) {
        return;
    }

    internalChange = true;
    if (syncLockTimer) clearTimeout(syncLockTimer);

    if (pendingPlayListener) {
        video.removeEventListener('canplay', pendingPlayListener);
        pendingPlayListener = null;
    }

    const needsSeek = Math.abs(video.currentTime - data.time) > 0.1;

    if (needsSeek) {
        internalChange = true;
        if (video.readyState >= 1) {
            video.currentTime = data.time;
        } else {
            video.addEventListener('loadedmetadata', () => {
                video.currentTime = data.time;
            }, { once: true });
        }

        video.addEventListener('seeked', () => {
            setTimeout(() => { internalChange = false; }, 50);
        }, { once: true });
    }
    
    if (data.type === 'play') {
        if (video.readyState >= 3) {
            internalChange = true;
            video.play().then(() => {
                internalChange = false;
            }).catch(e => {
                console.error("Playback failed:", e);
                internalChange = false;
            });
        } else {
            pendingPlayListener = () => {
                internalChange = true; 
                video.play().then(() => {
                    internalChange = false;
                }).catch(e => {
                    console.error("Delayed play failed:", e);
                    internalChange = false;
                });
                pendingPlayListener = null;
            };
            video.addEventListener('canplay', pendingPlayListener, { once: true });
        }
    } else if (data.type === 'pause') {
        internalChange = true;
        video.pause();
        internalChange = false;
    }
}

export function allowProgressAccess(show){
    if(show){
        progressContainer.classList.add('mouse-interact');
        //console.log("I am now a host/admin. Controls unlocked.");
    }
    else{
        progressContainer.classList.remove('mouse-interact');
        //console.log("I am now a guest. Controls locked.");
    }
}

export function bufferPause(){
    internalChange = true; 
    video.pause();
    setTimeout(() => { internalChange = false; }, 300);
    videoLoader.classList.add('visible');
}

export function bufferPlay(){
    internalChange = true;
    if (hls) {
        hls.startLoad();
    }
    video.play().catch(e => console.error("Auto-resume blocked:", e));
    setTimeout(() => { internalChange = false; }, 300);
    videoLoader.classList.remove('visible');
}

export function getVideoData(){
    return {currentTime: video.currentTime, paused: video.paused };
}

export function getVideoReadyState(){
    return video.readyState;
}

export function addMetaDataListener(data){
    video.addEventListener('loadedmetadata', () => executeSync(data), { once: true });
}

function resetIdleTimer() {
    wrapper.classList.remove('is-idle');

    clearTimeout(idleTimer);

    idleTimer = setTimeout(() => {
        if (!video.paused) {
            wrapper.classList.add('is-idle');
        }
    }, 2000);
}

// 2. The local logic functions
function togglePlay() {
    if (!State.sync_perm) {
        //console.log("Guests cannot control playback.");
        return;
    }
    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
}


function toggleFullscreen() {
    if (wrapper.requestFullscreen) { // Standard Web Fullscreen (Desktop, Android, iPad)
        if (!document.fullscreenElement) {
            wrapper.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    } else if (wrapper.webkitRequestFullscreen) { // Older WebKit fallback (Older Desktop/Android)
        if (!document.webkitFullscreenElement) {
            wrapper.webkitRequestFullscreen();
        } else {
            document.webkitExitFullscreen();
        }
    } else if (video.webkitEnterFullscreen) { // Older iPhones
        video.webkitEnterFullscreen(); 
    }
}

function toggleMute(){
    video.muted = !video.muted;
    if(video.muted){
        muteBtn.src = './img/volume-silence.svg';
    } else{
        muteBtn.src = './img/volume.svg';
    }
}

function toggleSubtitles() {
    const textTracks = video.textTracks;
    
    if (textTracks.length > 0) {
        const track = textTracks[0];
        
        if (track.mode === 'showing') {
            track.mode = 'hidden';
            ccIcon.src = "./img/closed-caption.svg"
            ccBtn.style.opacity = "0.5";     
        } 
        else {
            track.mode = 'showing';
            ccIcon.src = "./img/closed-caption-filled.svg"
            ccBtn.style.opacity = "1"; 
        }
    }
}

function updateVisualScrub(e) {
    const rect = progressContainer.getBoundingClientRect();
    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const scrubTime = (x / rect.width) * video.duration;
    
    if (!isNaN(scrubTime)) {
        const percentage = (scrubTime / video.duration) * 100;
        progressBar.style.width = percentage + '%';
        timeDisplay.innerText = `${formatTime(scrubTime)} / ${formatTime(video.duration)}`;
    }
}

export function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const parts = [
        h > 0 ? h : null,
        (h > 0 && m < 10 ? "0" : "") + m,
        (s < 10 ? "0" : "") + s
    ].filter(p => p !== null);
    
    return parts.join(":");
}
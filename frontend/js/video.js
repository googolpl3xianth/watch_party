// js/video.js
import Hls from 'hls.js';
import { HlsJsP2PEngine } from "p2p-media-loader-hlsjs";
window.Hls = Hls;
import { State } from './state.js';
import { emitSync, sync, checkSubtitles, clientBuffering, clientRecovered, emitQualityChange } from './network.js';

const hlsConfig = {
    startLevel: 0,
    capLevelToPlayerSize: true,
    maxBufferLength: 30, 
    maxMaxBufferLength: 60,
    abrEwmaDefaultEstimate: 500000, 
    abrBandWidthFactor: 0.6, 
    maxStarvationDelay: 2,
    enableWorker: true,
    lowLatencyMode: false,
    
    fragLoadingTimeOut: 15000, 
    manifestLoadingTimeOut: 10000,
    levelLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 2, 
    fragLoadingRetryDelay: 1000,
}
const CONFIG = {
    SYNC_THRESHOLD_SECONDS: 1.5,
    LOCK_TIMEOUT_MS: 300,
    HEARTBEAT_INTERVAL_MS: 3000,
    SEEK_SKIP_SECONDS: 5
};
const debounceTimer = 500;

let idleTimer;
let hls = null;
let isScrubbing = false;
let currentBasePath = "";
let spriteCues = [];

const wrapper = document.getElementById('video-wrapper');
const video = document.getElementById('myVideo');
const videoLoader = document.getElementById('video-loader');
const controls = document.querySelector('.video-overlay');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.querySelector('.progress-container');
const thumbPreview = document.getElementById('thumbnail-preview');
const timeDisplay = document.getElementById('time-display');
const playPauseIcon = document.getElementById('play-pause-icon');
const ccBtn = document.getElementById('subtitle-btn');
const ccIcon = document.getElementById('cc-icon');
const muteBtn = document.getElementById('mute-icon');
const screenBtn = document.getElementById('screen-play-btn')

export function setupVideoPlayer() {
    setUpVideoUI();

    let isCurrentlyBuffering = false;
    let wasPlayingBeforeScrub = false;
    let bufferDebounceTimer = null;
    let microGapTimer = null;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
            if (State.sync_perm) togglePlay();
            else sync();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            if (State.sync_perm) togglePlay();
            else sync();
        });

        navigator.mediaSession.setActionHandler('seekbackward', () => {
            if (State.sync_perm) {
                emitSync('seeking', video.currentTime - CONFIG.SEEK_SKIP_SECONDS);
            } else sync();
        });

        navigator.mediaSession.setActionHandler('seekforward', () => {
            if (State.sync_perm) {
                emitSync('seeking', video.currentTime + CONFIG.SEEK_SKIP_SECONDS);
            } else sync();
        });
    }

    video.addEventListener('play', () => {
        playPauseIcon.src = "/img/pause.svg";
        playPauseIcon.alt = "pause";
    });

    video.addEventListener('pause', () => {
        playPauseIcon.src = "/img/play.svg";
        playPauseIcon.alt = "play";
    });

    progressContainer.addEventListener('mousedown', (e) => {
        if(!State.sync_perm) return;
        isScrubbing = true;
        wasPlayingBeforeScrub = !video.paused;
        
        // Update the visual bar instantly where they clicked
        const rect = progressContainer.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const clickTime = (x / rect.width) * video.duration;
        
        const percentage = (clickTime / video.duration) * 100;
        progressBar.style.width = percentage + '%';
        timeDisplay.innerText = `${formatTime(clickTime)} / ${formatTime(video.duration)}`;
    });

    window.addEventListener('mouseup', (e) => {
        if (State.sync_perm && isScrubbing) {
            isScrubbing = false;

            const rect = progressContainer.getBoundingClientRect();
            let x = e.clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            const finalTime = (x / rect.width) * video.duration;
            
            if (!isNaN(finalTime)) {
                
                video.currentTime = finalTime; 
                emitSync('seeking', finalTime);
                
                if(wasPlayingBeforeScrub) {
                    video.play().catch(err => {
                        if (err.name !== 'AbortError') console.error("Playback failed:", err);
                    });
                    emitSync('play', finalTime);
                } else {
                    emitSync('pause', finalTime);
                }
            }
        }
    });

    progressContainer.addEventListener('mousemove', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        
        x = Math.max(0, Math.min(x, rect.width)); 
        const hoverTime = (x / rect.width) * video.duration;

        if (!isNaN(hoverTime)) {
            updateThumbnailPreview(hoverTime, x);

            if (isScrubbing) {
                const percentage = (hoverTime / video.duration) * 100;
                progressBar.style.width = percentage + '%';
                timeDisplay.innerText = `${formatTime(hoverTime)} / ${formatTime(video.duration)}`;
            }
        }
    });

    progressContainer.addEventListener('mouseleave', () => {
        thumbPreview.style.display = 'none'; // Hide the thumbnail
    });

    setInterval(() => {
        if (State.isHost && !video.paused && !window.isHotSwapping) {
            emitSync('heartbeat', video.currentTime);
        }
    }, CONFIG.HEARTBEAT_INTERVAL_MS);

    video.addEventListener('waiting', () => {
        if (!isCurrentlyBuffering) {
            bufferDebounceTimer = setTimeout(() => {
                isCurrentlyBuffering = true;
                videoLoader.classList.add('visible');
                if (State.hasJoined) clientBuffering(); 
            }, debounceTimer);
        }

        if (!microGapTimer) {
            microGapTimer = setInterval(() => {
                if (video.buffered.length > 0) {
                    const currentTime = video.currentTime;
                    let isSafelyBuffered = false;
                    
                    for (let i = 0; i < video.buffered.length; i++) {
                        const start = video.buffered.start(i);
                        const end = video.buffered.end(i);
                        const gapToStart = start - currentTime;
                        const forwardBuffer = end - currentTime;
                        
                        // SCENARIO A: The Micro-Gap (Trapped just behind a chunk boundary)
                        if (gapToStart > 0 && gapToStart < 0.5) {
                            console.warn(`[RECOVERY] Micro-gap of ${gapToStart.toFixed(3)}s detected. Nudging forward...`);
                            video.currentTime = start + 0.05; 
                            break; 
                        }

                        // SCENARIO B: The Ghost Pause (Trapped inside a block with plenty of data)
                        if (currentTime >= start && forwardBuffer >= 1.5) {
                            isSafelyBuffered = true;
                        }
                    }

                    // If the browser claims it's buffering, but we proved it has the data...
                    if (isSafelyBuffered && isCurrentlyBuffering) {
                        console.warn(`[RECOVERY] Decoder frozen inside a valid buffer! Kickstarting hardware...`);
                        
                        // 1. A microscopic nudge forces the C++ decoder to flush and find the Keyframe
                        video.currentTime += 0.001; 
                        
                        // 2. Forcefully break the room out of the deadlock!
                        isCurrentlyBuffering = false;
                        videoLoader.classList.remove('visible');
                        if (State.hasJoined) clientRecovered();
                        
                        // 3. Kill the detector
                        clearInterval(microGapTimer);
                        microGapTimer = null;
                    }
                }
            }, 1000); 
        }
    });

    video.addEventListener('canplay', () => {
        if (bufferDebounceTimer) clearTimeout(bufferDebounceTimer);
        if (microGapTimer) {
            clearInterval(microGapTimer);
            microGapTimer = null;
        }
        
        if (isCurrentlyBuffering) {
            isCurrentlyBuffering = false;
            videoLoader.classList.remove('visible');
            if (State.hasJoined) clientRecovered();
        }
    });

    video.addEventListener('timeupdate', () => {
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
            if (e.key === " " || e.code === "Space") togglePlay();
            else if (e.key === "ArrowRight") {
                video.currentTime += CONFIG.SEEK_SKIP_SECONDS;
                emitSync('seeking', video.currentTime);
            } else if (e.key === "ArrowLeft") {
                video.currentTime -= CONFIG.SEEK_SKIP_SECONDS;
                emitSync('seeking', video.currentTime);
            }
        }
        if (e.key === "f") toggleFullscreen();
        else if(e.key === "m") toggleMute();
        else if(e.key === "c") toggleSubtitles();
    });

    wrapper.addEventListener('mousemove', resetIdleTimer);
    wrapper.addEventListener('mousedown', resetIdleTimer);
    wrapper.addEventListener('keydown', resetIdleTimer);
    
    wrapper.addEventListener('fullscreenchange', resetIdleTimer);
    wrapper.addEventListener('webkitfullscreenchange', resetIdleTimer);

    video.addEventListener('loadedmetadata', () => {
        if (video.currentTime === 0 && !window.isHotSwapping) {
            video.currentTime = 0.001; 
        }
    });
}

export function setUpVideoUI(){
    video.controls = false;
    document.getElementById('screen-play-btn').addEventListener('click', togglePlay);
    document.getElementById('play-pause-btn').addEventListener('click', togglePlay);
    document.getElementById('sync-btn').addEventListener('click', sync);
    document.getElementById('mute-btn').addEventListener('click', toggleMute);
    document.getElementById('subtitle-btn').addEventListener('click', toggleSubtitles);
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
    document.getElementById('volume-slider').addEventListener('input', (e) => {video.volume = e.target.value;});
}

export function joinVideo(){
    wrapper.style.display = 'flex';
    video.style.display = 'block';
    controls.style.display = 'flex';

    video.muted = false;
    sync();
}

export async function setupVideo(filename, startOffset = -1) {
    if (!filename) return;
    playPauseIcon.src = "/img/play.svg";
    playPauseIcon.alt = "play";

    const title = document.getElementById('video-title');
    if (hls) { hls.destroy(); hls = null; }

    const trackElement = video.querySelector('track[kind="subtitles"]');
    if (trackElement) {
        if (trackElement.track) {
            trackElement.track.mode = 'hidden'; 
        }
        video.removeChild(trackElement);
    }

    video.innerHTML = '';
    ccBtn.style.display = 'none'; 

    const cleanName = filename.replace(/\\/g, '/');
    const encodedPath = cleanName.split('/').map(encodeURIComponent).join('/');
    const videoUrl = `${window.location.origin}/media/compressed/${encodedPath}`;
    const basePath = videoUrl.substring(0, videoUrl.lastIndexOf('/'));
    currentBasePath = basePath;
    spriteCues = [];

    if (filename.endsWith('.m3u8')) {
        video.removeAttribute('src'); 

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            if (startOffset > -1) {
                hlsConfig.startPosition = startOffset;
            } else {
                delete hlsConfig.startPosition;
            }

            delete hlsConfig.startLevel;

            const currentUserCount = Object.keys(State.usersArray || {}).length;
            const currentHost = window.location.host;
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const dynamicTrackerUrl = `${wsProtocol}//${currentHost}/tracker/`;

            if (currentUserCount >= State.p2pThreshold) {
                const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);

                hls = new HlsWithP2P({
                    ...hlsConfig, 
                    p2p: {
                        core: {
                            swarmId: videoUrl, 
                            announceTrackers: [dynamicTrackerUrl],
                            rtcConfig: {
                                iceServers: [
                                    { urls: 'stun:stun.l.google.com:19302' },
                                    { urls: 'stun:global.stun.twilio.com:3478' }
                                ]
                            }
                        }
                    }
                });

                /*hls.p2pEngine.addEventListener("onPeerConnect", (params) => {
                    console.log("%c[P2P SWARM] 🟢 PEER CONNECTED! ID:", "color: lime; font-weight: bold;", params.peerId);
                });*/

                /*hls.p2pEngine.addEventListener("onChunkDownloaded", (bytes, method) => {
                    if (method === 'p2p') {
                        console.log("%c[P2P SWARM] 🚀 DOWNLOADED FROM PEERS!", "color: cyan; font-weight: bold;");
                    } else {
                        console.log("%c[FALLBACK] 🐌 Downloaded from Server.", "color: gray;");
                    }
                });*/
            }
            else{
                hls = new Hls(hlsConfig);
            }

            const cacheBustedUrl = `${videoUrl}?t=${Date.now()}`;
            hls.loadSource(cacheBustedUrl);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                const qualitySelector = document.getElementById('quality-selector');

                if (hls.levels.length <= 1) {
                    qualitySelector.style.display = 'none';
                    return; 
                }

                qualitySelector.style.display = 'inline-block';
                qualitySelector.innerHTML = '<option value="-1" style="color: black;">Auto</option>'; 
                
                hls.levels.forEach((level, index) => {
                    const option = document.createElement('option');
                    option.value = index; 
                    let labelName = `${level.height}p`;
                    if (level.width === 1920) labelName = "1080p";
                    else if (level.width === 1280) labelName = "720p";
                    else if (level.width === 854) labelName = "480p";

                    option.textContent = labelName; 
                    option.style.color = 'black'; 
                    qualitySelector.appendChild(option);
                });

                let startingQuality = -1;

                if (State.targetQuality !== undefined) {
                    if (State.targetQuality === -2) {
                        startingQuality = hls.levels.length - 1; 
                    } else {
                        startingQuality = State.targetQuality;
                    }
                }

                if (startingQuality !== -1) {
                    hls.currentLevel = startingQuality;
                    hls.nextLoadLevel = startingQuality;
                }

                qualitySelector.value = startingQuality;

                qualitySelector.value = startingQuality;

                qualitySelector.addEventListener('change', (e) => {
                    const newLevel = parseInt(e.target.value);

                    hls.currentLevel = newLevel;
                    hls.nextLoadLevel = newLevel;
                    qualitySelector.value = newLevel
                    
                    if (State.sync_perm) {
                        emitQualityChange(newLevel);
                    }
                });
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
                const activeLevel = hls.levels[data.level];
                let labelName = `Auto (${activeLevel.height})`;
            
                const qualitySelector = document.getElementById('quality-selector');
                
                if (qualitySelector.value === "-1") {
                    const autoOption = qualitySelector.querySelector('option[value="-1"]');
                    if (autoOption) {
                        if (activeLevel.width === 1920) labelName = "Auto (1080p)";
                        else if (activeLevel.width === 1280) labelName = "Auto (720p)";
                        else if (activeLevel.width === 854) labelName = "Auto (480p)";
                        autoOption.textContent = labelName;
                    }
                }
            });
            
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.warn("Network error. Retrying...", data);
                            setTimeout(() => hls.startLoad(), 2000);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.warn("Fatal media error, recovering...", data);
                            hls.recoverMediaError();
                            break;
                        case Hls.ErrorTypes.OTHER_ERROR:
                            if (data.details === 'internalException') {
                                console.error("[DEMUXER CRASH] FMP4 parsing failed! The internal error is:", data.err);
                            }
                            hls.destroy();
                            break;
                        default:
                            console.error("Unrecoverable fatal error.", data);
                            hls.destroy();
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = videoUrl;
        }
    } else {
        video.src = videoUrl;
        video.load(); 
    }

    loadThumbnails(basePath);

    try {
        title.innerText = cleanName.split('/').slice(-2, -1)[0].replace('_HLS', '');
    } catch (e) {
        title.innerText = cleanName.split('/').slice(-2, -1)[0].replace('_HLS', '');
    }

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
                if (video.textTracks.length > 0) {
                    video.textTracks[0].mode = 'showing';
                    ccBtn.style.display = 'block';
                    ccBtn.style.color = "#ff0000"; 
                    ccBtn.style.opacity = "1";
                }
            });
        } else {
            ccBtn.style.display = 'none';
        }
    });
}

export function executeSync(data) {
    if (isScrubbing) {
        return; 
    }

    const needsSeek = Math.abs(video.currentTime - data.time) > 1.5;

    if (needsSeek) {
        if (video.readyState >= 1) {
            video.currentTime = data.time;
        } else {
            video.addEventListener('loadedmetadata', () => {
                video.currentTime = data.time;
            }, { once: true });
        }
    }
    
    if (data.type === 'play') {
        video.play().catch(e => {
            if (e.name !== 'AbortError') console.error("Playback failed:", e);
        });
        videoLoader.classList.remove('visible');
    } else if (data.type === 'pause') {
        video.pause();
    } else if (data.type === 'buffer') {
        videoLoader.classList.add('visible');
        video.pause();
    }
}

export function getVideoData(){
    return {currentTime: video.currentTime, paused: video.paused };
}

export function changeQuality(levelIndex){
    if (hls) {
        hls.currentLevel = levelIndex;
        hls.nextLoadLevel = levelIndex; 

        const qualitySelector = document.getElementById('quality-selector');
        if (qualitySelector) {
            qualitySelector.value = levelIndex;
        }
    }
}

function resetIdleTimer() {
    wrapper.classList.remove('is-idle');
    screenBtn.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (!video.paused) wrapper.classList.add('is-idle'); screenBtn.classList.add('is-idle');
    }, 2000);
}

function togglePlay() {
    if (!State.sync_perm) {
        sync();
        return;
    }
    if (video.paused) {
        emitSync('play', video.currentTime);
    } else {
        emitSync('pause', video.currentTime);
    }
}

function toggleFullscreen() {
    if (wrapper.requestFullscreen) { 
        if (!document.fullscreenElement) wrapper.requestFullscreen();
        else document.exitFullscreen();
    } else if (wrapper.webkitRequestFullscreen) { 
        if (!document.webkitFullscreenElement) wrapper.webkitRequestFullscreen();
        else document.webkitExitFullscreen();
    } else if (video.webkitEnterFullscreen) { 
        video.webkitEnterFullscreen(); 
    }
}

function toggleMute(){
    video.muted = !video.muted;
    if(video.muted){
        muteBtn.src = '/img/volume-silence.svg';
    } else{
        muteBtn.src = '/img/volume.svg';
    }
}

function toggleSubtitles() {
    const textTracks = video.textTracks;
    if (textTracks.length > 0) {
        const track = textTracks[0];
        if (track.mode === 'showing') {
            track.mode = 'hidden';
            ccIcon.src = "/img/closed-caption.svg"
            ccBtn.style.opacity = "0.5";    
        } 
        else {
            track.mode = 'showing';
            ccIcon.src = "/img/closed-caption-filled.svg"
            ccBtn.style.opacity = "1"; 
        }
    }
}

function loadThumbnails(basePath) {
    fetch(`${basePath}/thumbnails.vtt?t=${Date.now()}`)
        .then(res => {
            if (!res.ok) throw new Error("VTT not found (404)");
            return res.text();
        })
        .then(vttText => {
            //console.log("Thumbnails VTT successfully loaded!");
            const lines = vttText.replace(/\r/g, '').split('\n');
            let currentCue = null;
            spriteCues = []; 
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                if (line.includes('-->')) {
                    const times = line.split('-->');
                    currentCue = { 
                        start: parseVttTime(times[0]), 
                        end: parseVttTime(times[1]) 
                    };
                } else if (line.includes('#xywh=') && currentCue) {
                    currentCue.payload = line;
                    spriteCues.push(currentCue);
                    currentCue = null; 
                }
            }
        })
        .catch(e => {
        });
}

function parseVttTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    }
    return 0;
}

function updateThumbnailPreview(hoverTime, mouseX) {
    if (spriteCues.length === 0) {
        thumbPreview.style.display = 'none';
        return;
    }

    const activeCue = spriteCues.find(cue => hoverTime >= cue.start && hoverTime <= cue.end);

    if (activeCue && activeCue.payload) {
        const payload = activeCue.payload;
        const hashIndex = payload.indexOf('#xywh=');
        
        if (hashIndex !== -1) {
            const imgName = payload.substring(0, hashIndex);
            const coordsStr = payload.substring(hashIndex + 6);
            const [cx, cy, cw, ch] = coordsStr.split(',');

            thumbPreview.style.display = 'block';
            
            const rect = progressContainer.getBoundingClientRect();
            let safeX = mouseX;
            if (safeX < 80) safeX = 80; 
            if (safeX > rect.width - 80) safeX = rect.width - 80; 
            thumbPreview.style.left = `${safeX}px`;
            
            // THE FIX: Added literal quotes around the URL!
            thumbPreview.style.backgroundImage = `url("${currentBasePath}/${imgName}")`;
            thumbPreview.style.backgroundSize = '1600px 900px'; 
            thumbPreview.style.backgroundPosition = `-${cx}px -${cy}px`;
        }
    } else {
        thumbPreview.style.display = 'none';
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

export function reloadVideo(){
    if (hls && hls.p2pEngine) return;

    //console.log("[NETWORK] Swarm threshold reached! Hot-swapping to P2P Engine...");
    
    const savedTime = video.currentTime;
    const isCurrentlyPaused = video.paused;

    window.isHotSwapping = true;

    setupVideo(State.currentVideoFilename, savedTime).then(() => {
        const resumePlayback = () => {
            if (!isCurrentlyPaused) {
                video.play().catch(e => console.warn(e));
                setTimeout(() => {
                    emitSync('play', video.currentTime);
                }, 200);
            }
            window.isHotSwapping = false;
        };
        if (video.readyState >= 3) {
            resumePlayback();
        } else {
            video.addEventListener('canplay', resumePlayback, { once: true });
        }
    });
}

export function inspectBuffer() {
    const v = document.querySelector('video');
    const currentTime = v.currentTime;
    const buffers = v.buffered;
    
    //console.log(`%c--- BUFFER INSPECTION ---`, 'color: cyan; font-weight: bold;');
    //console.log(`Playhead is stuck at: ${currentTime.toFixed(2)}s`);
    
    if (buffers.length === 0) {
        //console.log("Buffer is completely empty!");
        return;
    }

    let foundHole = false;

    for (let i = 0; i < buffers.length; i++) {
        const start = buffers.start(i);
        const end = buffers.end(i);
        //console.log(`Block ${i}: [${start.toFixed(2)}s  -->  ${end.toFixed(2)}s]`);
        
        // If the playhead is between this block and the next block, we found the hole!
        if (currentTime >= end && i < buffers.length - 1) {
            const nextStart = buffers.start(i + 1);
            const missingSeconds = nextStart - end;
            //console.log(`%c🚨 DEADLOCK HOLE DETECTED: Missing video from ${end.toFixed(2)}s to ${nextStart.toFixed(2)}s (Gap size: ${missingSeconds.toFixed(2)}s)`, 'color: red; font-weight: bold;');
            
            // Calculate which chunk number this is (Assuming 2-second chunks)
            const missingChunkNum = Math.floor(end / 2);
            //console.log(`%c👉 The player is desperately waiting for Chunk #${missingChunkNum}`, 'color: yellow;');
            foundHole = true;
        }
    }

    if (!foundHole) {
        if (currentTime >= buffers.end(buffers.length - 1)) {
            //console.log(`%c🚨 DEADLOCK: Reached the absolute end of the downloaded buffer. Waiting for chunk #${Math.floor(currentTime / 2)}`, 'color: orange; font-weight: bold;');
        } else {
            //console.log("%c✅ The playhead is currently safely inside a buffered block.", 'color: green;');
        }
    }
}
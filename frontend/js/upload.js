// js/upload.js
import { Uppy, Dashboard, Tus } from "https://releases.transloadit.com/uppy/v3.21.0/uppy.min.mjs"
import { requestChange } from './network.js'
import { changeRoomStatus } from './ui.js'

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

const pollWait = 3000;
const chunkSize = 50 * 256 * 4 * 1024;

document.addEventListener('DOMContentLoaded', () => {
    const uppy = new Uppy({
        meta: { roomId: roomId },
        onBeforeFileAdded: (currentFile, files) => {
            return {
                ...currentFile,
                id: `${currentFile.id}-${roomId}`
            };
        }
    })
    .use(Dashboard, { 
        inline: false, 
        trigger: '#open-upload-modal-btn',
        closeModalOnClickOutside: true,
        proudlyDisplayPoweredByUppy: false,
        theme: 'dark'
    })
    .use(Tus, { 
        endpoint: import.meta.env.VITE_UPLOAD_URL, 
        chunkSize: chunkSize,
    });

    uppy.on('upload', () => {
        changeRoomStatus("Host is uploading a video...");
    });

    uppy.on('progress', (progress) => {
        changeRoomStatus(`Uploading to server... ${progress}%`);
    });

    uppy.on('cancel-all', () => {
        changeRoomStatus("Waiting on Host to load video");
    });

    uppy.on('complete', (result) => {
        const dashboard = uppy.getPlugin('Dashboard');
        if (dashboard) {
            if (document.activeElement) {
                document.activeElement.blur();
            }
            dashboard.closeModal();
        }

        const uploadedFile = result.successful[0];
        const originalName = uploadedFile.name;
        const videoFolderName = originalName.replace(/[^a-z0-9]/gi, '_') + '_HLS';
        const finalPath = `${roomId}/${videoFolderName}/master.m3u8`;
        const manifestUrl = `${window.location.origin}/media/compressed/${finalPath}`;

        const fileSizeMB = uploadedFile.size / (1024 * 1024);

        const estimatedSeconds = Math.max(15, Math.floor(fileSizeMB / 15)); 
    
        let progress = 0;
        changeRoomStatus(`Transcoding... 0% (Est. time: ${estimatedSeconds}s)`);

        // 2. Start a "Fake" progress interval
        const fakeProgressBar = setInterval(() => {
            progress += (100 / estimatedSeconds);
            
            // Cap it at 99% until the file actually exists
            if (progress > 99) progress = 99; 
            
            changeRoomStatus(`Transcoding... ${Math.floor(progress)}%`);
        }, 1000);
        
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(manifestUrl, { method: 'HEAD' });
                if (response.ok) {
                    clearInterval(fakeProgressBar);
                    clearInterval(pollInterval);
                    
                    changeRoomStatus(`Transcoding Complete! Finalizing files...`);
                    setTimeout(() => {
                        changeRoomStatus("");
                        requestChange(finalPath);
                    }, 3000); 
                }
            } catch (error) {
                // Keep waiting...
            }
        }, pollWait);
        setTimeout(() => uppy.cancelAll(), 1000);
    });
});
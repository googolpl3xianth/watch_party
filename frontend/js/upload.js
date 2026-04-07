// js/upload.js
import { Uppy, Dashboard, Tus } from "https://releases.transloadit.com/uppy/v3.21.0/uppy.min.mjs"
import { changeRoomStatus } from './ui.js'

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

const chunkSize = 50 * 256 * 4 * 1024;

const currentHost = window.location.host;
const httpProtocol = window.location.protocol; 
const dynamicUploadUrl = `${httpProtocol}//${currentHost}/upload/`;

document.addEventListener('DOMContentLoaded', () => {
    let isUploading = false;
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
        endpoint: dynamicUploadUrl, 
        chunkSize: chunkSize,
    });

    uppy.on('upload', () => {
        isUploading = true;
        changeRoomStatus("Host is uploading a video...");
    });

    uppy.on('progress', (progress) => {
        if (!isUploading) return;
        changeRoomStatus(`Uploading to server... ${progress}%`);
    });

    uppy.on('cancel-all', () => {
        if (!isUploading) return; 
        
        isUploading = false;
        changeRoomStatus("Waiting on Host to load video");
    });

    uppy.on('complete', (result) => {
        isUploading = false;

        const dashboard = uppy.getPlugin('Dashboard');
        if (dashboard) {
            if (document.activeElement) document.activeElement.blur();
            dashboard.closeModal();
        }
        
        setTimeout(() => uppy.cancelAll(), 1000);
    });
});
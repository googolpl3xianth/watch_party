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
    const uploadBtn = document.getElementById('open-upload-modal-btn');
    
    uploadBtn.disabled = true;
    const originalText = uploadBtn.innerText;
    uploadBtn.innerText = "Checking uploader status...";
    uploadBtn.style.opacity = "0.5";

    fetch(`${httpProtocol}//${currentHost}/upload/health`)
        .then(response => {
            if (response.ok) {
                uploadBtn.disabled = false;
                uploadBtn.innerText = originalText;
                uploadBtn.style.opacity = "1";
                initializeUppy(); 
            } else {
                throw new Error("Worker responded, but is unhealthy.");
            }
        })
        .catch(error => {
            uploadBtn.innerText = "Uploader Currently Offline";
            console.warn("[NETWORK] Upload worker is down:", error);
        });

    function initializeUppy() {
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
    }
});
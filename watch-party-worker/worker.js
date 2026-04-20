const express = require('express');
const { Server, EVENTS } = require('@tus/server');
const { FileStore } = require('@tus/file-store');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');
require('dotenv').config(); 

const app = express();

const maxSize = 5 * 1024 * 1024 * 1024

const UNCOMPRESSED_DIR = '/uncompressed';
const COMPRESSED_DIR = '/compressed';

const tusServer = new Server({
    path: '/upload',
    datastore: new FileStore({ directory: UNCOMPRESSED_DIR }),
    relativeLocation: true,
    maxSize: maxSize,
    allowedOrigins: ['https://watch-party-project.duckdns.org'],
    allowedHeaders: [
        'Origin', 'X-Requested-With', 'Content-Type', 'Accept', 
        'Authorization', 'Tus-Resumable', 'Upload-Length', 
        'Upload-Metadata', 'Upload-Offset'
    ],
    exposeHeaders: [
        'Location', 'Tus-Version', 'Tus-Resumable', 
        'Tus-Max-Size', 'Tus-Extension', 'Upload-Metadata', 
        'Upload-Length', 'Upload-Offset'
    ],
});

tusServer.on(EVENTS.POST_FINISH, (req, res, upload) => {
    const roomId = upload.metadata?.roomId || upload.id;
    const originalName = upload.metadata?.name || 'Uploaded Video';

    const videoFolderName = originalName.replace(/[^a-z0-9]/gi, '_') + '_HLS';

    const uploadedFilePath = path.join(UNCOMPRESSED_DIR, upload.id);
    const outputFolder = path.join(COMPRESSED_DIR, roomId, videoFolderName);

    try {
        fs.mkdirSync(outputFolder, { recursive: true });
        fs.writeFileSync(
            path.join(outputFolder, 'meta.json'), 
            JSON.stringify({ title: originalName })
        );
    } catch (err) {
        console.error("[ERROR] Failed to write meta.json:", err);
    }
    
    //console.log(`[SUCCESS] POST_FINISH: ${upload.id}`);
    //console.log(`[TRIGGER] Firing Bash script for: ${uploadedFilePath}`);

    const bashCommand = `bash /app/convert_videos.sh "${uploadedFilePath}" "${outputFolder}"`;

    const localSocket = io(`ws://${process.env.SERVER_IP}:3000`, {
        transports: ['websocket'],
        reconnection: false
    });

    localSocket.on('connect', () => {
        localSocket.emit('worker-transcode-start', { 
            roomId: roomId, 
            secret: `${process.env.UPLOAD_KEY}`,
            fileSize: upload.size // Pass the size so the frontend can calculate the estimate!
        });

        const workerProcess = spawn('bash', ['/app/convert_videos.sh', uploadedFilePath, outputFolder]);

        workerProcess.stdout.on('data', (data) => {
            console.log(`[BASH]: ${data.toString().trim()}`);
        });

        workerProcess.stderr.on('data', (data) => {
            //console.error(`[FFMPEG]: ${data.toString().trim()}`);
        });

        workerProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`[ERROR] Bash Script Failed with exit code ${code}`);
                return;
            }

            const relativePath = `${roomId}/${videoFolderName}/master.m3u8`;

            localSocket.emit('worker-transcode-ready', { 
                roomId: roomId, 
                secret: `${process.env.UPLOAD_KEY}` ,
                finalPath: relativePath
            });
            
            setTimeout(() => localSocket.disconnect(), 500);
        });
    });
    localSocket.on('connect_error', (err) => {
        console.error("[ERROR] Worker could not reach main Socket server:", err.message);
    });
});

app.get('/upload/health', (req, res) => {
    res.status(200).send('Worker is online and ready.');
});

app.post(/^\/upload($|\/.*)/, (req, res, next) => {
    const uploadMetadata = req.headers['upload-metadata'];

    if (!uploadMetadata) {
        return res.status(400).send('Missing Upload-Metadata header.');
    }

    let isAllowed = false;
    let decodedFilename = 'Unknown';

    try {
        uploadMetadata.split(',').forEach(pair => {
            const [key, encodedValue] = pair.trim().split(' ');
            if ((key === 'name' || key === 'filename') && encodedValue) {
                decodedFilename = Buffer.from(encodedValue, 'base64').toString('utf-8');
                const ext = path.extname(decodedFilename).toLowerCase();
                
                if (ext === '.mp4' || ext === '.mkv') {
                    isAllowed = true;
                }
            }
        });
    } catch (e) {
        return res.status(400).send('Corrupted Upload-Metadata header.');
    }

    if (!isAllowed) {
        console.warn(`[SECURITY] Blocked invalid file type: ${decodedFilename}`);
        return res.status(415).send('Unsupported Media Type. Only .mp4 and .mkv files are allowed.');
    }

    next(); 
});

app.all(/^\/upload($|\/.*)/, (req, res) => {
    tusServer.handle(req, res);
});

const PORT = 8081;
app.listen(PORT, '0.0.0.0', () => {
    //console.log(`[READY] Tus Worker Node listening on port ${PORT}`);
});
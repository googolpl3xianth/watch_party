const express = require('express');
const { Server, EVENTS } = require('@tus/server');
const { FileStore } = require('@tus/file-store');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();

const UNCOMPRESSED_DIR = '/uncompressed';
const COMPRESSED_DIR = '/compressed';

const tusServer = new Server({
    path: '/upload',
    datastore: new FileStore({ directory: UNCOMPRESSED_DIR }),
    relativeLocation: true,
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

    exec(bashCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`[ERROR] Bash Script Failed: ${error.message}`);
            return;
        }
        if (stderr) console.error(`[BASH-STDERR]: ${stderr}`);
        //console.log(`[BASH-OUTPUT]: ${stdout}`);
        //console.log(`[FINISHED] File is ready!`);
    });
});

app.all(/^\/upload($|\/.*)/, (req, res) => {
    tusServer.handle(req, res);
});

const PORT = 8081;
app.listen(PORT, '0.0.0.0', () => {
    //console.log(`[READY] Tus Worker Node listening on port ${PORT}`);
});
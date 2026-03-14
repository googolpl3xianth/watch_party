const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

async function getVideoList(dir = '/media/compressed', baseDir = '/media/compressed') {
    try {
        const files = await fsPromises.readdir(dir, { withFileTypes: true });

        const tasks = files.map(async (file) => {
            const fullPath = path.join(dir, file.name);

            if (file.isDirectory()) {
                const subFiles = await fsPromises.readdir(fullPath).catch(() => []);
                
                if (subFiles.includes('master.m3u8')) {
                    return path.relative(baseDir, path.join(fullPath, 'master.m3u8')).replace(/\\/g, '/');
                } else {
                    return await getVideoList(fullPath, baseDir);
                }
            } else if (file.name === 'master.m3u8') {
                return path.relative(baseDir, fullPath).replace(/\\/g, '/');
            }
            return null;
        });

        const results = await Promise.all(tasks);
        
        return results.flat().filter(Boolean);
        
    } catch (err) {
        console.error("Optimized search error:", err);
        return [];
    }
}

function deleteRoomVideo(roomId) {
    if(roomId.includes("../")){ return; }
    const safeRoomId = path.basename(roomId); 
    const folderPath = path.join('/media/compressed', safeRoomId);

    fs.access(folderPath, fs.constants.F_OK, (err) => {
        if (!err) {
            fs.rm(folderPath, { recursive: true, force: true }, (deleteErr) => {
                if (deleteErr) {
                    console.error(`[ERROR] Failed to delete video for room ${safeRoomId}:`, deleteErr);
                } else {
                    //console.log(`[CLEANUP] Deleted video files for room ${safeRoomId}`);
                }
            });
        }
    });
}

function runStartupCleanup() {
    //console.log("[SYSTEM] Running boot-time cleanup...");

    const uncompressedDir = '/media/uncompressed';
    if (fs.existsSync(uncompressedDir)) {
        fs.readdirSync(uncompressedDir).forEach(file => {
            fs.rmSync(path.join(uncompressedDir, file), { recursive: true, force: true });
        });
        //console.log(" -> Cleared /uncompressed");
    }

    // 2. Wipe orphaned Room folders (assuming 6-character alphanumeric IDs)
    const compressedDir = '/media/compressed';
    if (fs.existsSync(compressedDir)) {
        fs.readdirSync(compressedDir).forEach(folder => {
            if (/^[a-z0-9]{6}$/.test(folder)) {
                fs.rmSync(path.join(compressedDir, folder), { recursive: true, force: true });
                //console.log(` -> Removed orphaned room: ${folder}`);
            }
        });
    }
    //console.log("[SYSTEM] Cleanup complete.");
}

function checkFileSubtitles(filename, callback){
    const dir = path.dirname(filename); 
    const subPath = path.join('/media/compressed', dir, 'subtitles.vtt');

    fs.access(subPath, fs.constants.F_OK, (err) => {
        if (err) {
            callback(false); 
        } else {
            callback(true); 
        }
    });
}

function sanitize(str) {
    if (!str) return 'Guest';
    return str.replace(/[<>\/""']/g, '').substring(0, 20); 
}

module.exports = {
    getVideoList,
    checkFileSubtitles,
    sanitize,
    deleteRoomVideo,
    runStartupCleanup
};
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
async function getVideoList(dir = '/videos', allFiles = []) {
    try {
        const files = await fsPromises.readdir(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            
            if (file.isDirectory()) {
                await getVideoList(fullPath, allFiles);
            } else {
                if (file.name === 'master.m3u8') {
                    const folderName = path.basename(path.dirname(fullPath));
                    const relativePath = path.posix.join(folderName, 'master.m3u8');
                    allFiles.push(relativePath);
                }
            }
        }
        return allFiles;
    } catch (err) {
        console.error("Recursive search error:", err);
        return allFiles;
    }
}

function checkFileSubtitles(filename, callback){
    const dir = path.dirname(filename); 
    const subPath = path.join('/videos', dir, 'subtitles.vtt');

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
    sanitize
};
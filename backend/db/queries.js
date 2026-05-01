// backend/db/queries.js
const db = require('./index');

async function createRoom(roomId, hostId) {
    const sql = `
        INSERT INTO rooms (room_id, host_id, created_at) 
        VALUES ($1, $2, NOW()) 
        RETURNING *;
    `;
    const result = await db.query(sql, [roomId, hostId]);
    return result.rows[0];
}

async function deleteRoom(roomId){
    db.query(`DELETE FROM rooms WHERE room_id = $1`, [roomId]);
}

async function cleanupRooms(){
    try {
        await db.query(`DELETE FROM rooms`);

        await db.query(`DELETE FROM videos WHERE room_id IS NULL`);
    } catch (err) {
        console.error("  -> Failed to clean Database on boot:", err);
    }
}

async function saveVideo(roomId, videoName, videoPath) {
    const sql = `
        INSERT INTO videos (room_id, title, file_path, uploaded_at) 
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (file_path) DO NOTHING
        RETURNING *;
    `;
    const result = await db.query(sql, [roomId, videoName, videoPath]);
    return result.rows?.[0] || null;
}

async function getVideoList(roomId){
    const sql = `
        SELECT file_path 
        FROM videos 
        WHERE room_id IS NULL OR room_id = $1;
    `;
    const result = await db.query(sql, [roomId]);
    
    return result.rows.map(row => row.file_path);
}

module.exports = {
    createRoom,
    deleteRoom,
    cleanupRooms,
    saveVideo,
    getVideoList
};
CREATE TABLE IF NOT EXISTS rooms (
    room_id VARCHAR(10) PRIMARY KEY,
    host_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
    video_id SERIAL PRIMARY KEY,
    room_id VARCHAR(10) REFERENCES rooms(room_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(file_path)
);
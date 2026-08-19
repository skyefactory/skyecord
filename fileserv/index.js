import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const UPLOADS_DIR = '/mnt/share/skyecord_files/';
const app = express();
const allowedOrigins = new Set([
    'https://skyecord.skyefactory.com',
]);

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const PORT = 50422;

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false // true only if using cookies
}));
app.use(express.json());
async function verifyAccess(roomId, sessionId, filepath){
    if (!sessionId) {
        console.log('No sessionId provided');
        return false;
    }
    try {
        const query = 'SELECT * FROM sessions WHERE sessionId = ?';
        const [rows] = await pool.execute(query, [sessionId]);
        if(rows.length > 0){
            // check if a) the file is listed in the db, and b) the file requested is in the same room as the session
            const fileQuery = 'SELECT * FROM messages_log WHERE roomID = ? AND filepath = ?';
            const [fileRows] = await pool.execute(fileQuery, [roomId, filepath]);
            if(fileRows.length > 0){
                return true;
            } else {
                console.log(`File ${filepath} not found in room ${roomId}`);
                return false;
            }
        } else{
            console.log('Session not found in database');
            return false;
        }
    } catch (error) {
        console.error(error);
        return false;
    }
}

app.get(UPLOADS_DIR+':filename',async (req, res) => {
    const roomId = req.query.roomId;
    const sessionId = req.query.sessionId;
    const filename = req.params.filename;
    const filepath = path.join(UPLOADS_DIR, filename);
    const access = await verifyAccess(roomId, sessionId, filepath);
    console.log(`Access check for session: ${sessionId}, room: ${roomId}, file: ${filename} => ${access}`);
    if(access){
        const safename = path.basename(filename);
        console.log(`Serving file: ${filepath} to session: ${sessionId} in room: ${roomId}`);
        if(!fs.existsSync(filepath)){
            res.status(404).send('File not found');
            return;
        }

        const stat = fs.statSync(filepath);

        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${safename}"`
        });

        const fileStream = fs.createReadStream(filepath,{ highWaterMark: 16 * 1024 });
        fileStream.pipe(res);

        fileStream.on('error', (err) => {   
            console.error('Streaming error:', err);
            if (!res.headersSent) {
                res.status(500).send('Error streaming file');
            }
        });
    } else {
        res.status(403).send('Access denied');
    }
});

app.listen(PORT, () => {
    console.log(`File server is running on port ${PORT}`);
});
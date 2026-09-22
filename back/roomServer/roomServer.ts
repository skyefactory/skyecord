import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();


const app: express.Express = express();
const allowedOrigins: Set<string> = new Set([
    'https://skyecord.skyefactory.com',
]);

app.use(cors({
    origin(origin: any, callback: any) {
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

const pool: mysql.Pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.get('/getRooms', async (req: express.Request, res: express.Response) => {
    const secret = req.body.roomSecret;
})

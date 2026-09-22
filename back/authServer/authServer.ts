import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
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

app.post('/login', async (req: express.Request, res: express.Response) => {
    const { username, password } = req.body;

    try {
        const [rows]: any = await pool.execute(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];
        const isMatch: boolean = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let sessionId = '';
        for (let i = 0; i < 32; i++) {
            sessionId += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        try{
            //1: check if session already exists for this user
            const [existingSession]: any = await pool.execute(
                'SELECT * FROM sessions WHERE userId = ?',
                [user.id]
            );

            if (existingSession.length > 0) {
                // If a session already exists, delete it
                await pool.execute(
                    'DELETE FROM sessions WHERE userId = ?',
                    [user.id]
                );
            }

            await pool.execute(
                'INSERT INTO sessions (sessionId, userId, expires_at) VALUES (?, ?, ?)',
                [sessionId, user.id, new Date(Date.now() + 24 * 7 * 60 * 60 * 1000)]
            );
            res.json({ sessionID: sessionId });
        } catch (error) {
            console.error('Error during login:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/verify-session', async (req: express.Request, res: express.Response) => {
    const sessionId = req.body.sessionID;
    try{
        const [rows]: any = await pool.execute(
            'SELECT * FROM sessions WHERE sessionId = ?',
            [sessionId]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid session' });
        }

        const session = rows[0];
        const now = new Date();

        if (now > new Date(session.expires_at)) {
            await pool.execute(
                'DELETE FROM sessions WHERE sessionId = ?',
                [sessionId]
            );
            return res.status(401).json({ error: 'Session expired' });
        }

        res.json({ valid: true });
    } catch (error) {
        console.error('Error during session verification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.listen(50421, () => {
    console.log('Auth server is running on port 50421');
});
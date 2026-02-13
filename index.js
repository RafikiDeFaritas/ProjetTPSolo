const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- Configuration from Environment Variables ---
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || 'admin_password';
const DB_NAME = process.env.DB_NAME || 'macrocoach_db';

const DB_HOST_WRITE = process.env.DB_HOST_WRITE || 'postgres-primary';
const DB_HOST_READ_1 = process.env.DB_HOST_READ_1 || 'postgres-replica-1';
const DB_HOST_READ_2 = process.env.DB_HOST_READ_2 || 'postgres-replica-2';

// --- Connection Pools ---

// 1. Write Pool (Primary)
const poolWrite = new Pool({
    user: DB_USER,
    host: DB_HOST_WRITE,
    database: DB_NAME,
    password: DB_PASS,
    port: 5432,
});

// 2. Read Pool 1 (Replica 1)
const poolRead1 = new Pool({
    user: DB_USER,
    host: DB_HOST_READ_1,
    database: DB_NAME,
    password: DB_PASS,
    port: 5432,
});

// 3. Read Pool 2 (Replica 2)
const poolRead2 = new Pool({
    user: DB_USER,
    host: DB_HOST_READ_2,
    database: DB_NAME,
    password: DB_PASS,
    port: 5432,
});

// Function to get a random Read Pool (Round-Robin / Random Logic)
const getReadPool = () => {
    const pools = [poolRead1, poolRead2];
    const randomIndex = Math.floor(Math.random() * pools.length);
    const selectedPool = pools[randomIndex];
    const hostName = randomIndex === 0 ? DB_HOST_READ_1 : DB_HOST_READ_2;
    return { pool: selectedPool, host: hostName };
};


// --- Initialization ---
const initDB = async (retries = 5, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
        try {
            // Create table matches on Primary if not exists with business schema
            await poolWrite.query(`
                CREATE TABLE IF NOT EXISTS matches (
                    id SERIAL PRIMARY KEY,
                    summoner_name VARCHAR(255) NOT NULL,
                    champion VARCHAR(100) NOT NULL,
                    kda VARCHAR(50),
                    win BOOLEAN,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('✅ Base de données initialisée (Table `matches` vérifiée sur Primary).');
            return; // Success, exit function
        } catch (err) {
            console.error(`❌ Erreur lors de l'initialisation de la DB (Tentative ${i + 1}/${retries}):`, err.message);
            if (i < retries - 1) {
                console.log(`⏳ Nouvelle tentative dans ${delay / 1000}s...`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                console.error('🚨 Impossible d\'initialiser la base de données après plusieurs tentatives.');
            }
        }
    }
};

// Listen for connection errors
poolWrite.on('error', (err) => console.error('Unexpected error on WRITE client', err));
poolRead1.on('error', (err) => console.error('Unexpected error on READ1 client', err));
poolRead2.on('error', (err) => console.error('Unexpected error on READ2 client', err));

// Start Initialization moved to bottom
// initDB();

// --- Endpoints ---

// ---------------------------------------------------------
// 1. BUSINESS ENDPOINTS (MacroCoach)
// ---------------------------------------------------------

// --- Business Logic / Validation (For Unit Tests) ---
const validateMatchData = (data) => {
    const { summoner_name, champion, kda, win } = data;
    const errors = [];
    if (!summoner_name || typeof summoner_name !== 'string') errors.push('Invalid summoner_name');
    if (!champion || typeof champion !== 'string') errors.push('Invalid champion');
    if (kda && !/^\d+\/\d+\/\d+$/.test(kda)) errors.push('Invalid KDA format (e.g. 10/2/5)');
    if (win !== undefined && typeof win !== 'boolean') errors.push('Invalid win status');
    return { valid: errors.length === 0, errors };
};

// POST /api/match : Insert a new match
app.post('/api/match', async (req, res) => {
    const validation = validateMatchData(req.body);

    if (!validation.valid) {
        return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    const { summoner_name, champion, kda, win } = req.body;


    try {
        const queryText = 'INSERT INTO matches(summoner_name, champion, kda, win) VALUES($1, $2, $3, $4) RETURNING *';
        const values = [summoner_name, champion, kda || '0/0/0', win === undefined ? false : win];

        const result = await poolWrite.query(queryText, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding match:', err);
        res.status(500).json({ error: 'Failed to add match', details: err.message });
    }
});

// GET /api/history : Get last 10 matches (Read from Replica)
app.get('/api/history', async (req, res) => {
    try {
        const { pool, host } = getReadPool();
        const result = await pool.query('SELECT * FROM matches ORDER BY created_at DESC LIMIT 10');

        res.json({
            source: host, // Useful for debugging load balancing
            data: result.rows
        });
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ error: 'Failed to fetch history', details: err.message });
    }
});


// ---------------------------------------------------------
// 2. DIAGNOSTIC ENDPOINTS (TP Requirements)
// ---------------------------------------------------------

// GET /db/status
app.get('/db/status', async (req, res) => {
    try {
        // Check connection to all 3 DBs
        const statusWrite = await poolWrite.query('SELECT 1');
        const statusRead1 = await poolRead1.query('SELECT 1');
        const statusRead2 = await poolRead2.query('SELECT 1');

        res.json({
            status: 'success',
            connections: {
                primary: !!statusWrite,
                replica1: !!statusRead1,
                replica2: !!statusRead2
            },
            message: 'API is connected to all 3 databases (Primary + 2 Replicas).'
        });
    } catch (err) {
        console.error('Status Error:', err);
        res.status(500).json({ error: 'Database connection failed', details: err.message });
    }
});

// POST /db/write-test
app.post('/db/write-test', async (req, res) => {
    try {
        // Insert dummy data that fits the schema
        const queryText = 'INSERT INTO matches(summoner_name, champion, kda, win) VALUES($1, $2, $3, $4) RETURNING *';
        const values = ['Test Summoner', 'Test Champion', '0/0/0', false];

        // Always write to Primary
        const result = await poolWrite.query(queryText, values);
        const insertedRow = result.rows[0];

        // Strict JSON return format required by TP
        res.json({
            host_used: DB_HOST_WRITE,
            role: 'WRITE',
            inserted_id: insertedRow.id,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Write Error:', err);
        res.status(500).json({ error: 'Write operation failed', details: err.message });
    }
});

// GET /db/read-test
app.get('/db/read-test', async (req, res) => {
    try {
        // Select a random replica
        const { pool, host } = getReadPool();

        // Read the last inserted data
        const result = await pool.query('SELECT * FROM matches ORDER BY created_at DESC LIMIT 1');

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No data found in matches table' });
        }

        // Strict JSON return format required by TP
        res.json({
            host_used: host,
            role: 'READ',
            data: result.rows[0]
        });

    } catch (err) {
        console.error('Read Error:', err);
        res.status(500).json({ error: 'Read operation failed', details: err.message });
    }
});

const PORT = 3000;
if (require.main === module) {
    // Start Initialization
    initDB();

    app.listen(PORT, () => {
        console.log(`🚀 API listening on port ${PORT}`);
    });
}

// Export for testing
module.exports = { validateMatchData, app };

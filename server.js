const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 Server starting...');

// ───────────────────────────────────────────────
// TOKEN SYSTEM
// ───────────────────────────────────────────────
const tokens = new Map();

function generateToken(userKey) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 60_000; // 60 seconds

    tokens.set(token, { userKey, expires });

    // auto cleanup
    setTimeout(() => tokens.delete(token), 60_000);

    return token;
}

function consumeToken(token) {
    const entry = tokens.get(token);

    if (!entry) return null;

    if (Date.now() > entry.expires) {
        tokens.delete(token);
        return null;
    }

    tokens.delete(token); // 🔥 one-time use
    return entry.userKey;
}

// ───────────────────────────────────────────────
// FAKE KEY VALIDATION (replace with real later)
// ───────────────────────────────────────────────
async function isKeyValid(userKey) {
    // 🔥 YOU CAN REPLACE THIS WITH DATABASE / API CHECK
    return typeof userKey === 'string' && userKey.length > 5;
}

// ───────────────────────────────────────────────
// ROUTES
// ───────────────────────────────────────────────
app.get('/get_token', async (req, res) => {
    const userKey = req.query.user_key;

    if (!userKey) {
        return res.status(400).json({ error: 'Missing user_key' });
    }

    const valid = await isKeyValid(userKey);

    if (!valid) {
        return res.status(403).json({ error: 'Invalid key' });
    }

    const token = generateToken(userKey);

    res.json({
        success: true,
        token,
        expiresIn: 60
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: tokens.size,
        clients: wss ? wss.clients.size : 0
    });
});

// ───────────────────────────────────────────────
// SERVER + WEBSOCKET
// ───────────────────────────────────────────────
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ noServer: true });

// Handle upgrade
server.on('upgrade', (req, socket, head) => {
    try {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } catch (err) {
        console.error('[UPGRADE ERROR]', err);
        socket.destroy();
    }
});

// ───────────────────────────────────────────────
// WEBSOCKET CONNECTION
// ───────────────────────────────────────────────
wss.on('connection', (ws, req) => {
    const rawUrl = req.url || '/';
    const qIndex = rawUrl.indexOf('?');

    const params = qIndex >= 0
        ? new URLSearchParams(rawUrl.slice(qIndex + 1))
        : new URLSearchParams();

    const token = params.get('token');
    const userKey = token ? consumeToken(token) : null;

    if (!userKey) {
        try {
            ws.send(JSON.stringify({ type: 'expired' }));
        } catch {}

        ws.close(4001, 'Unauthorized');
        console.log('❌ Rejected connection (bad token)');
        return;
    }

    const clientId = crypto.randomBytes(4).toString('hex');
    console.log(`✅ Client ${clientId} connected (key: ${userKey})`);

    ws.send(JSON.stringify({
        type: 'welcome',
        clientId,
        message: 'Connected successfully'
    }));

    // ───── KEEP ALIVE / PING ─────
    ws.on('message', (msg) => {
        let data;

        try {
            data = JSON.parse(msg.toString());
        } catch {
            return;
        }

        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
        }

        // (optional) broadcast
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(msg.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log(`❌ Client ${clientId} disconnected`);
    });
});

// ───────────────────────────────────────────────
// CLEANUP LOOP
// ───────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();

    for (const [token, entry] of tokens.entries()) {
        if (now > entry.expires) {
            tokens.delete(token);
        }
    }
}, 30000);

// ───────────────────────────────────────────────
// START SERVER
// ───────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🌐 Running on port ${PORT}`);
});

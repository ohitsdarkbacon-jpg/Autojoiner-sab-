// ─── IMPORTS ───────────────────────────────────
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

// ─── CONFIG ────────────────────────────────────
const PORT = process.env.PORT || 8080;
const USER_KEY = process.env.USER_KEY; // <-- only here
if (!USER_KEY) {
    console.error("❌ ERROR: USER_KEY environment variable not set!");
    process.exit(1);
}

const WS_URL = "wss://yourbackend.com";  // update if needed
const HTTP_URL = "https://yourbackend.com"; // update if needed

// ─── APP ──────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── TOKEN SYSTEM ───────────────────────────────
const tokens = new Map();

function generateToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 60_000; // 60 seconds
    tokens.set(token, expires);
    setTimeout(() => tokens.delete(token), 60_000);
    return token;
}

function consumeToken(token) {
    const expires = tokens.get(token);
    if (!expires) return false;
    if (Date.now() > expires) {
        tokens.delete(token);
        return false;
    }
    tokens.delete(token); // single-use
    return true;
}

// ─── TOKEN ROUTE ───────────────────────────────
app.get('/get_token', (req, res) => {
    // Only backend knows USER_KEY; no key from client needed
    const token = generateToken();
    res.json({ token, expiresIn: 60 });
});

// ─── HEALTH CHECK ─────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: tokens.size,
        connectedClients: wss ? wss.clients.size : 0,
        timestamp: new Date().toISOString()
    });
});

// ─── HTTP & WS SERVER ─────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// ─── HANDLE WS UPGRADE ────────────────────────
server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

// ─── WEBSOCKET CONNECTION ─────────────────────
wss.on('connection', (ws, req) => {
    const rawUrl = req.url || '/';
    const qIndex = rawUrl.indexOf('?');
    const params = qIndex >= 0 ? new URLSearchParams(rawUrl.slice(qIndex + 1)) : new URLSearchParams();
    const token = params.get('token');

    if (!token || !consumeToken(token)) {
        try { ws.send(JSON.stringify({ type: 'expired' })); } catch {}
        ws.close(4001, 'Unauthorized');
        return;
    }

    const clientId = crypto.randomBytes(4).toString('hex');
    console.log(`✅ Client ${clientId} connected (Total: ${wss.clients.size})`);

    ws.send(JSON.stringify({
        type: 'welcome',
        clientId,
        message: 'Connected successfully!',
        timestamp: new Date().toISOString()
    }));

    ws.on('message', (msg) => {
        let data;
        try { data = JSON.parse(msg.toString()); } catch { return; }

        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
    });

    ws.on('close', () => {
        console.log(`❌ Client ${clientId} disconnected`);
    });
});

// ─── CLEANUP EXPIRED TOKENS ───────────────────
setInterval(() => {
    const now = Date.now();
    for (const [token, expires] of tokens.entries()) {
        if (now > expires) tokens.delete(token);
    }
}, 30_000);

// ─── START SERVER ─────────────────────────────
server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`   HTTP token endpoint: ${HTTP_URL}/get_token`);
    console.log(`   WS connect: ${WS_URL}?token=TOKEN`);
});

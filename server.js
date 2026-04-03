const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map();

console.log('🚀 Server starting...');

// ================= TOKEN =================
app.post('/gettoken', (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 1000; // ✅ 60 seconds

    ACTIVE_TOKENS.set(token, expiresAt);

    res.json({
        success: true,
        token,
        expiresIn: 60
    });
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        tokens: ACTIVE_TOKENS.size
    });
});

const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

// ================= WS SERVER =================
const wss = new WebSocket.Server({ noServer: true });

// ✅ UPGRADE HANDLER
server.on('upgrade', (req, socket, head) => {
    console.log('[UPGRADE] Incoming request');

    try {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } catch (err) {
        console.error('[UPGRADE ERROR]', err);
        socket.destroy();
    }
});

// ================= CONNECTION =================
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    console.log('[WS] Connection attempt');

    // Hard kill if stuck
    const timeout = setTimeout(() => {
        console.log('[WS] ❌ Timeout kill');
        ws.terminate();
    }, 10000);

    // ❌ INVALID TOKEN
    if (!token || !ACTIVE_TOKENS.has(token)) {
        console.log('[WS] ❌ Invalid token');
        ws.close(1008, "Invalid token");
        return;
    }

    const exp = ACTIVE_TOKENS.get(token);

    // ❌ EXPIRED TOKEN
    if (Date.now() > exp) {
        ACTIVE_TOKENS.delete(token);
        console.log('[WS] ❌ Token expired');
        ws.close(1008, "Expired token");
        return;
    }

    // ✅ VALID → allow session forever
    clearTimeout(timeout);
    ACTIVE_TOKENS.delete(token);

    const clientId = crypto.randomBytes(4).toString('hex');
    console.log(`✅ Client ${clientId} connected`);

    ws.send(JSON.stringify({
        type: 'welcome',
        clientId
    }));

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg.toString());
        } catch {
            return;
        }

        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
        }
    });

    ws.on('close', () => {
        console.log(`❌ ${clientId} disconnected`);
    });
});

// ================= START =================
server.listen(PORT, () => {
    console.log(`🌐 Running on port ${PORT}`);
});

// ================= CLEANUP =================
setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of ACTIVE_TOKENS.entries()) {
        if (now > exp) {
            ACTIVE_TOKENS.delete(token);
        }
    }
}, 30000);

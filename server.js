const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map();

console.log('🚀 Trulys WebSocket Server Starting...');

// ==================== TOKEN ENDPOINT ====================
app.post('/gettoken', (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 1000; // 60 seconds

    ACTIVE_TOKENS.set(token, expiresAt);

    res.json({
        success: true,
        token,
        expiresIn: 60
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: ACTIVE_TOKENS.size,
        timestamp: new Date().toISOString()
    });
});

// ==================== HTTP + WS SETUP ====================
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ noServer: true });

// Upgrade handler
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

// ==================== WEBSOCKET CONNECTION ====================
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    console.log('[WS] Connection attempt with token:', token);

    if (!token || !ACTIVE_TOKENS.has(token)) {
        console.log('[WS] ❌ Invalid token');
        ws.close(1008, "Invalid token");
        return;
    }

    const exp = ACTIVE_TOKENS.get(token);
    if (Date.now() > exp) {
        ACTIVE_TOKENS.delete(token);
        console.log('[WS] ❌ Token expired');
        ws.close(1008, "Token expired");
        return;
    }

    // Do NOT delete token immediately; allow reconnects briefly
    ACTIVE_TOKENS.set(token, Date.now() + 5000);

    const clientId = crypto.randomBytes(4).toString('hex');
    console.log(`✅ Client ${clientId} connected (Total: ${wss.clients.size})`);

    // Send welcome
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId,
        message: 'Connected successfully!',
        timestamp: new Date().toISOString()
    }));

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg.toString());
        } catch {
            return;
        }

        // Ping/pong support
        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
    });

    ws.on('close', () => {
        console.log(`❌ Client ${clientId} disconnected`);
    });
});

// ==================== CLEANUP EXPIRED TOKENS ====================
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, exp] of ACTIVE_TOKENS.entries()) {
        if (now > exp) {
            ACTIVE_TOKENS.delete(token);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} expired tokens`);
}, 30000);

// ==================== START SERVER ====================
server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`   HTTP: http://localhost:${PORT}/gettoken`);
    console.log(`   WS: ws://localhost:${PORT}?token=YOUR_TOKEN_HERE`);
});

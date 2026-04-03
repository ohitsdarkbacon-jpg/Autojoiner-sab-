const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map();

console.log('🚀 Server starting...');

// ====== TOKEN GENERATION ======
app.post('/gettoken', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
        ACTIVE_TOKENS.set(token, expiresAt);
        res.json({
            success: true,
            token,
            expiresIn: 300 // 5 minutes
        });
    } catch (err) {
        console.error('[TOKEN ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to generate token' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: ACTIVE_TOKENS.size,
        connectedClients: wss ? wss.clients.size : 0,
        timestamp: new Date().toISOString()
    });
});

// ====== HTTP & WS SERVER ======
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ noServer: true });

// ====== HANDLE WS UPGRADE ======
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

// ====== WS CONNECTION LOGIC ======
wss.on('connection', (ws, req) => {
    const urlObj = new URL(req.url, 'http://dummy'); // base ignored
    const token = urlObj.searchParams.get('token');

    if (!token || !ACTIVE_TOKENS.has(token)) {
        ws.close(1008, 'Invalid token');
        return;
    }

    const expiresAt = ACTIVE_TOKENS.get(token);
    if (Date.now() > expiresAt) {
        ACTIVE_TOKENS.delete(token);
        ws.close(1008, 'Token expired');
        return;
    }

    // ✅ Token is valid — keep it in ACTIVE_TOKENS until it expires
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
        try {
            data = JSON.parse(msg.toString());
        } catch {
            return;
        }

        // ping/pong keep-alive
        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
    });

    ws.on('close', () => {
        console.log(`❌ Client ${clientId} disconnected`);
    });
});

// ====== CLEANUP EXPIRED TOKENS ======
setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of ACTIVE_TOKENS.entries()) {
        if (now > exp) ACTIVE_TOKENS.delete(token);
    }
}, 30000);

server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`   HTTP Token: http://localhost:${PORT}/gettoken`);
    console.log(`   WS connect: ws://localhost:${PORT}?token=TOKEN`);
});

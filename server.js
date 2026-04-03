const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map();
const CLIENTS = new Map(); // track session clients

console.log('🚀 Trulys WebSocket Server Starting...');

// ==================== TOKEN ENDPOINT ====================
app.post('/gettoken', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 60 * 1000; // 60 seconds
        ACTIVE_TOKENS.set(token, expiresAt);

        res.json({
            success: true,
            token,
            expiresIn: 60
        });
        console.log(`[TOKEN] Issued token ${token} (expires in 60s)`);
    } catch (error) {
        console.error('Token generation error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate token' });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: ACTIVE_TOKENS.size,
        connectedClients: CLIENTS.size,
        timestamp: new Date().toISOString()
    });
});

// ==================== HTTP + WS SERVER ====================
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ noServer: true });

// ==================== WS UPGRADE HANDLER ====================
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

// ==================== WS CONNECTION ====================
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    console.log(`[WS] Connection attempt from ${req.socket.remoteAddress}`);

    // Check token validity
    if (!token || !ACTIVE_TOKENS.has(token)) {
        console.log(`[WS] ❌ Invalid or missing token`);
        ws.close(1008, 'Invalid token');
        return;
    }

    const expiresAt = ACTIVE_TOKENS.get(token);
    if (Date.now() > expiresAt) {
        ACTIVE_TOKENS.delete(token);
        console.log(`[WS] ❌ Token expired`);
        ws.close(1008, 'Token expired');
        return;
    }

    // Token valid, delete it — session is now active
    ACTIVE_TOKENS.delete(token);
    const clientId = crypto.randomBytes(4).toString('hex');
    CLIENTS.set(clientId, ws);

    console.log(`✅ Client ${clientId} connected (Total: ${CLIENTS.size})`);

    ws.send(JSON.stringify({
        type: 'welcome',
        clientId,
        message: 'Connected successfully!',
        timestamp: new Date().toISOString()
    }));

    // ==================== MESSAGE HANDLING ====================
    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg.toString());
        } catch {
            data = { type: 'text', content: msg.toString() };
        }

        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }

        // Broadcast to all other clients
        CLIENTS.forEach((clientWs, id) => {
            if (id !== clientId && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        });
    });

    ws.on('close', () => {
        CLIENTS.delete(clientId);
        console.log(`❌ Client ${clientId} disconnected (Total: ${CLIENTS.size})`);
    });
});

// ==================== EXPIRED TOKEN CLEANUP ====================
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    for (const [token, exp] of ACTIVE_TOKENS.entries()) {
        if (now > exp) {
            ACTIVE_TOKENS.delete(token);
            expiredCount++;
        }
    }
    if (expiredCount > 0) {
        console.log(`🧹 Cleaned up ${expiredCount} expired tokens`);
    }
}, 30000);

// ==================== START SERVER ====================
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   HTTP: http://localhost:${PORT}/gettoken`);
    console.log(`   WS: ws://localhost:${PORT}?token=YOURTOKEN`);
});

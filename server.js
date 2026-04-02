const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map(); // token → expiresAt

console.log('Trulys WebSocket Server Starting...');

// ==================== GET TEMPORARY TOKEN (60 seconds) ====================
app.post('/gettoken', (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 1000; // 60 seconds

    ACTIVE_TOKENS.set(token, expiresAt);

    console.log(`[${new Date().toISOString()}] New temporary token issued`);

    res.json({
        token: token,
        expiresIn: 60
    });
});

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `wss://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !ACTIVE_TOKENS.has(token)) {
        console.log("❌ Invalid token - rejected");
        ws.close(1008, "Invalid token");
        return;
    }

    const expiresAt = ACTIVE_TOKENS.get(token);
    if (Date.now() > expiresAt) {
        ACTIVE_TOKENS.delete(token);
        console.log("❌ Token expired - rejected");
        ws.close(1008, "Token expired");
        return;
    }

    // Single-use token
    ACTIVE_TOKENS.delete(token);

    console.log("✅ Valid connection accepted");

    ws.on('message', (message) => {
        console.log('Received:', message.toString());

        // Broadcast to all clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Cleanup expired tokens
setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of ACTIVE_TOKENS) {
        if (now > exp) ACTIVE_TOKENS.delete(token);
    }
}, 30000);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT} (/gettoken)`);
});

console.log(`WebSocket Server running on port ${PORT}`);

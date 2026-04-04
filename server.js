// ─── IMPORTS ───────────────────────────────
const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const crypto = require('crypto');
const express = require('express');

// ─── CONFIG ────────────────────────────────
const PORT = process.env.PORT || 8080;
const TOKEN_PORT = 3000; // HTTP endpoint for token fetch
const USER_KEY = process.env.USER_KEY || "secret123";

// ─── TLS CERTIFICATES ──────────────────────
// Replace with your real certs in production
const serverOptions = {
    key: fs.readFileSync('server.key'),   // your TLS private key
    cert: fs.readFileSync('server.crt')   // your TLS certificate
};

// ─── TOKEN SYSTEM ──────────────────────────
const tokens = new Map(); // token -> expiry timestamp

function generateToken() {
    const token = crypto.randomBytes(16).toString('hex');
    const expires = Date.now() + 60_000; // 60 seconds
    tokens.set(token, expires);
    setTimeout(() => tokens.delete(token), 60_000);
    return token;
}

function consumeToken(token) {
    const expiry = tokens.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) { tokens.delete(token); return false; }
    tokens.delete(token); // single-use
    return true;
}

// ─── EXPRESS TOKEN SERVER ──────────────────
const app = express();

app.get('/get_token', (req, res) => {
    const token = generateToken();
    res.json({ token, expiresIn: 60 });
});

app.listen(TOKEN_PORT, () => console.log(`HTTP token endpoint running on port ${TOKEN_PORT}`));

// ─── HTTPS SERVER FOR WSS ─────────────────
const httpsServer = https.createServer(serverOptions);
httpsServer.listen(PORT, () => console.log(`WSS server running on port ${PORT}`));

// ─── WEBSOCKET SERVER ─────────────────────
const wss = new WebSocket.Server({ server: httpsServer });

wss.on('connection', (ws, req) => {
    try {
        const url = new URL(req.url, `https://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token || !consumeToken(token)) {
            ws.send(JSON.stringify({ type: 'expired' }));
            ws.close(4001, 'Unauthorized');
            return;
        }

        const clientId = crypto.randomBytes(4).toString('hex');
        console.log(`✅ Client ${clientId} connected via WSS`);

        ws.send(JSON.stringify({ type: 'welcome', clientId }));

        ws.on('message', (msg) => {
            console.log('Received:', msg.toString());

            // Broadcast to all connected clients
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            });
        });

        ws.on('close', () => {
            console.log(`❌ Client ${clientId} disconnected`);
        });

    } catch (err) {
        console.log('❌ WS error:', err.message);
    }
});

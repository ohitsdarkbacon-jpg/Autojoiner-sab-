// ─── IMPORTS ───────────────────────────────
const WebSocket = require('ws');
const crypto = require('crypto');

// ─── CONFIG ────────────────────────────────
const PORT = process.env.PORT || 8080;
const USER_KEY = process.env.USER_KEY || "secret123"; // change in env

// ─── TOKEN SYSTEM ──────────────────────────
const tokens = new Map(); // token -> expiry timestamp

function generateToken() {
    const token = crypto.randomBytes(16).toString('hex');
    const expires = Date.now() + 60_000; // 60s
    tokens.set(token, expires);

    // auto-delete
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

// ─── SIMPLE HTTP TOKEN FETCH ──────────────
const express = require('express');
const app = express();

app.get('/get_token', (req, res) => {
    const token = generateToken();
    res.json({ token, expiresIn: 60 });
});

app.listen(3000, () => console.log('HTTP token endpoint running on port 3000'));

// ─── WEBSOCKET SERVER ─────────────────────
const wss = new WebSocket.Server({ port: PORT });
console.log('WebSocket server started on port', PORT);

wss.on('connection', (ws, req) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token || !consumeToken(token)) {
            ws.send(JSON.stringify({ type: 'expired' }));
            ws.close(4001, 'Unauthorized');
            return;
        }

        const clientId = crypto.randomBytes(4).toString('hex');
        console.log(`✅ Client ${clientId} connected`);

        ws.send(JSON.stringify({ type: 'welcome', clientId }));

        ws.on('message', (msg) => {
            console.log('Received:', msg.toString());

            // broadcast
            wss.clients.forEach((client) => {
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

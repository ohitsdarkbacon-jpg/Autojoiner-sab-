const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Active tokens map: token -> expiration timestamp
const ACTIVE_TOKENS = new Map();

console.log('🚀 Server starting...');

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
    } catch (err) {
        console.error('[TOKEN ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to generate token' });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: ACTIVE_TOKENS.size,
        connectedClients: wss ? wss.clients.size : 0,
        timestamp: new Date().toISOString()
    });
});

// ==================== HTTP SERVER ====================
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ noServer: true });

// Upgrade handler to check tokens
server.on('upgrade', (req, socket, head) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        // Validate token
        if (!token || !ACTIVE_TOKENS.has(token)) {
            console.log('[WS] ❌ Invalid token');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        const exp = ACTIVE_TOKENS.get(token);
        if (Date.now() > exp) {
            ACTIVE_TOKENS.delete(token);
            console.log('[WS] ❌ Token expired');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
           

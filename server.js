// ─── IMPORTS ───────────────────────────────────
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const crypto = require('crypto');

// ─── CONFIG ────────────────────────────────────
const PORT = process.env.PORT || 8080;
const USER_KEY = process.env.USER_KEY;

if (!USER_KEY) {
    console.error("❌ ERROR: USER_KEY environment variable not set!");
    process.exit(1);
}

// ─── STATE ─────────────────────────────────────
const tokens = new Map(); // session tokens

const app = express();
app.use(express.json());

// ─── TOKEN SYSTEM ───────────────────────────────
function generateToken() {
    const token = crypto.randomBytes(32).toString('hex');

    // ⬆️ Increased lifetime (important for Roblox delays)
    const expires = Date.now() + 180_000; // 3 minutes

    tokens.set(token, { expires });

    setTimeout(() => tokens.delete(token), 180_000);

    return token;
}

function consumeToken(token) {
    const entry = tokens.get(token);

    if (!entry) {
        console.log("❌ Token not found:", token);
        return null;
    }

    if (Date.now() > entry.expires) {
        console.log("❌ Token expired:", token);
        tokens.delete(token);
        return null;
    }

    tokens.delete(token); // single-use
    return true;
}

// ─── ROUTES ────────────────────────────────────

// Get token
app.get('/get_token', (req, res) => {
    const token = generateToken();

    res.json({
        token,
        expiresIn: 180
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: tokens.size,
        connectedClients: wss.clients.size,
        timestamp: new Date().toISOString()
    });
});

// ─── SERVER SETUP ──────────────────────────────
const server = http.createServer(app);

// ✅ IMPORTANT: attach WS directly to server (Railway fix)
const wss = new WebSocket.Server({ server });

// ─── WEBSOCKET CONNECTION ─────────────────────
wss.on('connection', (ws, req) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token || !consumeToken(token)) {
            console.log("❌ Unauthorized WS attempt:", token);

            try {
                ws.send(JSON.stringify({ type: 'expired' }));
            } catch {}

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

        // ─── MESSAGE HANDLING ─────────────────────
        ws.on('message', (msg) => {
            let data;

            try {
                data = JSON.parse(msg.toString());
            } catch {
                console.log("⚠️ Invalid JSON received");
                return;
            }

            // Ping/pong
            if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                }));
                return;
            }

            // Log incoming data (your Roblox payload)
            console.log("📩 Data received:", data);
        });

        ws.on('close', (code, reason) => {
            console.log(`❌ Client ${clientId} disconnected (${code})`);
        });

        ws.on('error', (err) => {
            console.log(`⚠️ WS Error (${clientId}):`, err.message);
        });

    } catch (err) {
        console.log("❌ Connection error:", err.message);
    }
});

// ─── CLEANUP EXPIRED TOKENS ───────────────────
setInterval(() => {
    const now = Date.now();

    for (const [token, entry] of tokens.entries()) {
        if (now > entry.expires) {
            tokens.delete(token);
        }
    }
}, 30_000);

// ─── START SERVER ─────────────────────────────
server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`🔑 Token endpoint: /get_token`);
    console.log(`❤️ Health check: /health`);
});

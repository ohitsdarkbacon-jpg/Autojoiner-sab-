const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

app.set('trust proxy', true);

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "User-Agent"]
}));

app.use(express.json());

const ACTIVE_TOKENS = new Map();

// ==================== GET TOKEN (60 seconds) ====================
app.post('/gettoken', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 60 * 1000;   // ← 60 seconds

        ACTIVE_TOKENS.set(token, expiresAt);

        console.log(`[${new Date().toISOString()}] New 60s token issued`);

        res.json({
            success: true,
            token: token,
            expiresIn: 60
        });
    } catch (error) {
        console.error('Token error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate token' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'running', activeTokens: ACTIVE_TOKENS.size });
});

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !ACTIVE_TOKENS.has(token)) {
        ws.close(1008, "Invalid token");
        return;
    }

    if (Date.now() > ACTIVE_TOKENS.get(token)) {
        ACTIVE_TOKENS.delete(token);
        ws.close(1008, "Token expired");
        return;
    }

    ACTIVE_TOKENS.delete(token); // Single-use

    console.log(`✅ Client connected | Total: ${wss.clients.size}`);

    ws.on('message', (message) => {
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log(`Client disconnected | Remaining: ${wss.clients.size}`);
    });
});

// Important: Upgrade handler for Railway
const server = app.listen(process.env.PORT || 8080, () => {
    console.log(`🚀 Server running on port ${process.env.PORT || 8080}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// Cleanup expired tokens
setInterval(() => {
    const now = Date.now();
    let count = 0;
    for (const [token, exp] of ACTIVE_TOKENS.entries()) {
        if (now > exp) {
            ACTIVE_TOKENS.delete(token);
            count++;
        }
    }
    if (count > 0) console.log(`Cleaned ${count} expired tokens`);
}, 30000);

console.log("✅ Trulys Backend Ready (60s tokens)");

// ─── IMPORTS ───────────────────────────────────
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const crypto = require('crypto');

// ─── CONFIG ────────────────────────────────────
const PORT = process.env.PORT || 8080;
const USER_KEY = process.env.USER_KEY;

if (!USER_KEY) {
    console.error("❌ ERROR: USER_KEY not set!");
    process.exit(1);
}

// ─── STATE ─────────────────────────────────────
const challenges = new Map();

const app = express();
app.use(express.json());

// ─── CHALLENGE ENDPOINT ────────────────────────
app.get('/challenge', (req, res) => {
    const challenge = crypto.randomBytes(16).toString('hex');

    challenges.set(challenge, Date.now());

    // expires in 30s
    setTimeout(() => {
        challenges.delete(challenge);
    }, 30000);

    res.json({ challenge });
});

// ─── HEALTH ────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeChallenges: challenges.size,
        clients: wss.clients.size,
        time: new Date().toISOString()
    });
});

// ─── SERVER ────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── VERIFY FUNCTION ───────────────────────────
function verifyClient(challenge, sig) {
    if (!challenge || !sig) return false;
    if (!challenges.has(challenge)) return false;

    const expected = crypto
        .createHash('sha256')
        .update(challenge + USER_KEY)
        .digest('hex');

    if (expected !== sig) return false;

    challenges.delete(challenge); // one-time use
    return true;
}

// ─── WS CONNECTION ─────────────────────────────
wss.on('connection', (ws, req) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const challenge = url.searchParams.get('challenge');
        const sig = url.searchParams.get('sig');

        if (!verifyClient(challenge, sig)) {
            console.log("❌ Unauthorized WS attempt");
            ws.close(4001, "Unauthorized");
            return;
        }

        const clientId = crypto.randomBytes(4).toString('hex');
        console.log(`✅ Client ${clientId} connected`);

        ws.send(JSON.stringify({
            type: "welcome",
            clientId
        }));

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                console.log("📩 Data:", data);
            } catch {
                console.log("⚠️ Invalid JSON");
            }
        });

        ws.on('close', () => {
            console.log(`❌ Client ${clientId} disconnected`);
        });

    } catch (err) {
        console.log("❌ WS error:", err.message);
    }
});

// ─── START ─────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🌐 Running on port ${PORT}`);
});

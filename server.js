// server.js - Luarmor Expiry Matching + HWID-bound Token
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map();

// ==================== CONFIG ====================
const LUARMOR_API_KEY = "YOUR_LUARMOR_API_KEY_HERE";   // ← Put your real Luarmor API key
const WS_BASE_URL = "wss://your-websocket-domain.com"; // ← Your real WS domain

// Validate Luarmor Key and get exact expiry
async function validateLuarmorKey(key) {
    try {
        const resp = await axios.get(`https://api.luarmor.net/v3/check?key=${key}`, {
            headers: { 'Authorization': `Bearer ${LUARMOR_API_KEY}` }
        });

        const data = resp.data;

        if (data.status === "valid" && data.expiresAt) {
            const expiresAt = new Date(data.expiresAt).getTime();
            return {
                valid: true,
                expiresAt: expiresAt,
                username: data.username || "Unknown"
            };
        }
        return { valid: false, reason: data.reason || "Invalid key" };
    } catch (e) {
        console.error("Luarmor API error:", e.message);
        return { valid: false, reason: "API error" };
    }
}

// ==================== GET WS ENDPOINT ====================
app.post('/getws', async (req, res) => {
    const { script_key, hwid, userId, username } = req.body;

    if (!script_key || !hwid) {
        return res.status(400).json({ error: "Missing script_key or hwid" });
    }

    const validation = await validateLuarmorKey(script_key);

    if (!validation.valid) {
        return res.status(401).json({ error: validation.reason || "Invalid Luarmor key" });
    }

    // Token expires at the same time as Luarmor key (minus 5 minutes safety buffer)
    const expiresAt = validation.expiresAt - (5 * 60 * 1000);

    const token = crypto.randomBytes(32).toString('hex');

    ACTIVE_TOKENS.set(token, {
        hwid: hwid,
        expiresAt: expiresAt,
        script_key: script_key
    });

    console.log(`✅ Token issued | HWID: ${hwid.substring(0,15)}... | Expires: ${new Date(expiresAt).toISOString()}`);

    res.json({
        url: WS_BASE_URL,
        token: token,
        expiresIn: Math.floor((expiresAt - Date.now()) / 1000)
    });
});

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

wss.on('connection', (ws, req) => {
    try {
        const url = new URL(req.url, `wss://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token || !ACTIVE_TOKENS.has(token)) {
            ws.close(1008, "Invalid token");
            return;
        }

        const data = ACTIVE_TOKENS.get(token);

        if (Date.now() > data.expiresAt) {
            ACTIVE_TOKENS.delete(token);
            ws.close(1008, "Token expired");
            return;
        }

        console.log(`✅ Protected connection accepted`);

        ws.on('message', (message) => {
            try {
                const d = JSON.parse(message);
                console.log(`[Brainrot] ${d.name} | $${d.money}/s`);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(message);
                    }
                });
            } catch(e){}
        });

    } catch (e) {
        ws.close();
    }
});

// Cleanup expired tokens
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of ACTIVE_TOKENS) {
        if (now > data.expiresAt) ACTIVE_TOKENS.delete(token);
    }
}, 60000);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

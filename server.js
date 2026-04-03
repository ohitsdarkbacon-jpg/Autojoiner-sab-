const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', true);

app.use(cors({ origin: "*" }));
app.use(express.json());

const ACTIVE_TOKENS = new Map();

// ==================== TOKEN ENDPOINT ====================
app.post('/gettoken', (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    ACTIVE_TOKENS.set(token, Date.now() + 60 * 1000);

    console.log(`[${new Date().toISOString()}] New 60s token issued`);
    res.json({ success: true, token: token, expiresIn: 60 });
});

app.get('/health', (req, res) => res.json({ status: 'running' }));

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ 
    noServer: true,
    pingInterval: 15000,
    pingTimeout: 40000
});

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !ACTIVE_TOKENS.has(token)) {
        ws.close(1008, "Invalid token");
        return;
    }
    if (Date.now() > ACTIVE_TOKENS.get(token)) {
        ws.close(1008, "Token expired");
        return;
    }

    ACTIVE_TOKENS.delete(token);
    console.log(`✅ Client connected | Total: ${wss.clients.size}`);

    ws.send(JSON.stringify({ type: "echo", message: "Successfully connected to Trulys Hub" }));

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📨 Received from client:`, data);

            // Broadcast to all other clients
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });

            // Echo back to sender
            ws.send(JSON.stringify({ type: "echo", status: "received", original: data }));
        } catch (e) {
            console.log("📨 Raw message:", message.toString());
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected | Remaining: ${wss.clients.size}`);
    });
});

const server = app.listen(process.env.PORT || 8080, () => {
    console.log(`🚀 Server running on port ${process.env.PORT || 8080}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

console.log("✅ Trulys Backend Ready - Message sending/receiving enabled");

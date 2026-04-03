const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map();
let wss = null;

console.log('Trulys WebSocket Server Starting...');

app.post('/gettoken', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 60 * 1000;
        ACTIVE_TOKENS.set(token, expiresAt);
        
        // Return BOTH ws and wss URLs
        res.json({
            success: true,
            token: token,
            expiresIn: 60,
            wsUrl: `ws://autojoiner-sab-production.up.railway.app`,
            wssUrl: `wss://autojoiner-sab-production.up.railway.app`
        });
    } catch (error) {
        console.error('Token error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate token' });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: ACTIVE_TOKENS.size,
        connectedClients: wss ? wss.clients.size : 0,
        timestamp: new Date().toISOString()
    });
});

// Create HTTP server
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

// Create WebSocket server on the same port
wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    
    console.log(`[WebSocket] Connection attempt from ${req.socket.remoteAddress}`);
    
    if (!token || !ACTIVE_TOKENS.has(token)) {
        console.log(`❌ Invalid token - rejecting`);
        ws.close(1008, "Invalid token");
        return;
    }
    
    const expiresAt = ACTIVE_TOKENS.get(token);
    if (Date.now() > expiresAt) {
        ACTIVE_TOKENS.delete(token);
        console.log(`❌ Token expired - rejecting`);
        ws.close(1008, "Token expired");
        return;
    }
    
    ACTIVE_TOKENS.delete(token);
    const clientId = crypto.randomBytes(4).toString('hex');
    console.log(`✅ Client ${clientId} connected (Total: ${wss.clients.size})`);
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: 'Connected successfully!',
        timestamp: new Date().toISOString()
    }));
    
    ws.on('message', (message) => {
        try {
            const messageStr = message.toString();
            console.log(`📨 From ${clientId}:`, messageStr.substring(0, 100));
            
            let parsedMessage;
            try {
                parsedMessage = JSON.parse(messageStr);
            } catch {
                parsedMessage = { type: 'text', content: messageStr };
            }
            
            // Handle ping
            if (parsedMessage.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                return;
            }
            
            // Broadcast to others
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(messageStr);
                }
            });
        } catch (error) {
            console.error('Error:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`❌ Client ${clientId} disconnected`);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   HTTP: http://localhost:${PORT}/gettoken`);
    console.log(`   WebSocket: ws://localhost:${PORT}?token=TOKEN`);
});

// Cleanup expired tokens
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

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    wss.close(() => {
        process.exit(0);
    });
});

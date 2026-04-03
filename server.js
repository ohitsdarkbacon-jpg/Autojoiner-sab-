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

// ==================== TOKEN ENDPOINT ====================
app.post('/gettoken', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 60 * 1000;

        ACTIVE_TOKENS.set(token, expiresAt);

        console.log(`[${new Date().toISOString()}] New token issued: ${token.substring(0, 8)}...`);

        res.json({
            success: true,
            token: token,
            expiresIn: 60,
            wsUrl: `wss://autojoiner-sab-production.up.railway.app`
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

// ==================== WEBSOCKET SERVER WITH BETTER TIMEOUT HANDLING ====================
const startWebSocketServer = (port) => {
    const server = new WebSocket.Server({ 
        port: port,
        // These options help prevent timeouts
        clientTracking: true,
        perMessageDeflate: false, // Disable compression for faster responses
        maxPayload: 1024 * 1024, // 1MB max payload
    });
    
    // Increase timeout for the server
    server.shouldHandle = (req) => {
        return true;
    };
    
    server.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        console.log(`[WebSocket] Connection attempt from ${req.socket.remoteAddress}`);
        console.log(`[WebSocket] Token provided: ${token ? 'Yes (length: ' + token.length + ')' : 'No'}`);
        
        // Validate token
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
        
        // Token is valid, remove it (single use)
        ACTIVE_TOKENS.delete(token);
        
        const clientId = crypto.randomBytes(4).toString('hex');
        console.log(`✅ Client ${clientId} connected (Total: ${server.clients.size})`);
        
        // Set up ping/pong to keep connection alive
        let isAlive = true;
        
        ws.on('pong', () => {
            isAlive = true;
        });
        
        // Send welcome message immediately
        try {
            ws.send(JSON.stringify({
                type: 'welcome',
                clientId: clientId,
                message: 'Connected successfully!',
                timestamp: new Date().toISOString()
            }));
        } catch (err) {
            console.error('Failed to send welcome:', err);
        }
        
        // Heartbeat interval to check if client is alive
        const interval = setInterval(() => {
            if (!isAlive) {
                console.log(`Client ${clientId} heartbeat timeout - terminating`);
                ws.terminate();
                return;
            }
            
            isAlive = false;
            try {
                ws.ping();
            } catch (err) {
                console.log(`Failed to ping client ${clientId}:`, err.message);
                ws.terminate();
            }
        }, 15000); // Check every 15 seconds
        
        ws.on('message', (message) => {
            try {
                const messageStr = message.toString();
                console.log(`📨 Received from ${clientId}:`, messageStr.substring(0, 100));
                
                let parsedMessage;
                try {
                    parsedMessage = JSON.parse(messageStr);
                } catch {
                    parsedMessage = { type: 'text', content: messageStr };
                }
                
                // Handle ping messages
                if (parsedMessage.type === 'ping') {
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: new Date().toISOString()
                    }));
                    return;
                }
                
                // Broadcast to all other clients
                let recipients = 0;
                server.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(messageStr);
                        recipients++;
                    }
                });
                
                // Echo back to sender
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'echo',
                        received: parsedMessage,
                        timestamp: new Date().toISOString()
                    }));
                }
                
                console.log(`📤 Broadcasted to ${recipients} clients`);
            } catch (error) {
                console.error(`Error processing message:`, error);
            }
        });
        
        ws.on('close', (code, reason) => {
            clearInterval(interval);
            console.log(`❌ Client ${clientId} disconnected (Code: ${code})`);
            console.log(`📊 Remaining clients: ${server.clients.size}`);
        });
        
        ws.on('error', (error) => {
            clearInterval(interval);
            console.error(`WebSocket error for ${clientId}:`, error.message);
        });
    });
    
    server.on('error', (error) => {
        console.error('WebSocket server error:', error);
    });
    
    wss = server;
    console.log(`🔌 WebSocket Server running on port ${port}`);
    return server;
};

// ==================== START SERVER ====================
const PORT = process.env.PORT || 8080;

// Create HTTP server
const httpServer = http.createServer(app);

// Start WebSocket on same port
const wsServer = new WebSocket.Server({ 
    server: httpServer,
    path: '/' // Accept connections on root path
});

// Move the connection handling to wsServer
wsServer.on('connection', (ws, req) => {
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
    console.log(`✅ Client ${clientId} connected (Total: ${wsServer.clients.size})`);
    
    let isAlive = true;
    
    ws.on('pong', () => {
        isAlive = true;
    });
    
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: 'Connected!',
        timestamp: new Date().toISOString()
    }));
    
    const interval = setInterval(() => {
        if (!isAlive) {
            console.log(`Client ${clientId} timeout`);
            ws.terminate();
            return;
        }
        isAlive = false;
        ws.ping();
    }, 15000);
    
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
            
            if (parsedMessage.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                return;
            }
            
            wsServer.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(messageStr);
                }
            });
        } catch (error) {
            console.error('Error:', error);
        }
    });
    
    ws.on('close', () => {
        clearInterval(interval);
        console.log(`❌ Client ${clientId} disconnected`);
    });
    
    ws.on('error', (error) => {
        clearInterval(interval);
        console.error(`Error for ${clientId}:`, error.message);
    });
});

httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   HTTP: http://localhost:${PORT}/gettoken`);
    console.log(`   WebSocket: ws://localhost:${PORT}?token=YOUR_TOKEN`);
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
    if (wsServer) {
        wsServer.clients.forEach((client) => {
            client.close(1000, 'Server shutting down');
        });
        wsServer.close(() => {
            console.log('WebSocket closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

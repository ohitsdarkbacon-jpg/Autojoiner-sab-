const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_TOKENS = new Map(); // token → expiresAt
let wss = null;

console.log('Trulys WebSocket Server Starting...');

// ==================== GET TEMPORARY TOKEN (60 seconds) ====================
app.post('/gettoken', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 60 * 1000; // 60 seconds

        ACTIVE_TOKENS.set(token, expiresAt);

        console.log(`[${new Date().toISOString()}] New temporary token issued`);

        res.json({
            success: true,
            token: token,
            expiresIn: 60,
            wsUrl: `ws://localhost:${process.env.WS_PORT || 8080}`
        });
    } catch (error) {
        console.error('Token generation error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate token' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: ACTIVE_TOKENS.size,
        connectedClients: wss ? wss.clients.size : 0,
        timestamp: new Date().toISOString()
    });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    res.json({
        activeTokens: ACTIVE_TOKENS.size,
        connectedClients: wss ? wss.clients.size : 0,
        uptime: process.uptime()
    });
});

// ==================== WEBSOCKET SERVER WITH PORT HANDLING ====================
const startWebSocketServer = (port, maxAttempts = 3) => {
    let attempts = 0;
    
    const tryListen = (portToTry) => {
        try {
            const server = new WebSocket.Server({ port: portToTry });
            
            server.on('connection', (ws, req) => {
                const url = new URL(req.url, `wss://${req.headers.host}`);
                const token = url.searchParams.get('token');

                if (!token || !ACTIVE_TOKENS.has(token)) {
                    console.log(`❌ Invalid token from ${req.socket.remoteAddress} - rejected`);
                    ws.close(1008, "Invalid token");
                    return;
                }

                const expiresAt = ACTIVE_TOKENS.get(token);
                if (Date.now() > expiresAt) {
                    ACTIVE_TOKENS.delete(token);
                    console.log(`❌ Token expired from ${req.socket.remoteAddress} - rejected`);
                    ws.close(1008, "Token expired");
                    return;
                }

                // Single-use token
                ACTIVE_TOKENS.delete(token);

                const clientId = crypto.randomBytes(4).toString('hex');
                console.log(`✅ Client ${clientId} connected (Total: ${server.clients.size})`);

                ws.on('message', (message) => {
                    try {
                        const messageStr = message.toString();
                        console.log(`📨 Received from ${clientId}:`, messageStr);
                        
                        // Parse and validate JSON if needed
                        let parsedMessage;
                        try {
                            parsedMessage = JSON.parse(messageStr);
                        } catch {
                            parsedMessage = { type: 'text', content: messageStr };
                        }
                        
                        // Broadcast to all connected clients
                        let recipients = 0;
                        server.clients.forEach((client) => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(messageStr);
                                recipients++;
                            }
                        });
                        
                        // Also echo back to sender
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'echo',
                                original: parsedMessage,
                                timestamp: new Date().toISOString()
                            }));
                        }
                        
                        console.log(`📤 Broadcasted to ${recipients} clients`);
                    } catch (error) {
                        console.error(`Error processing message from ${clientId}:`, error);
                        ws.send(JSON.stringify({ error: 'Failed to process message' }));
                    }
                });

                ws.on('close', (code, reason) => {
                    console.log(`❌ Client ${clientId} disconnected (Code: ${code}, Reason: ${reason || 'No reason'})`);
                    console.log(`📊 Remaining clients: ${server.clients.size}`);
                });

                ws.on('error', (error) => {
                    console.error(`WebSocket error for ${clientId}:`, error.message);
                });
            });

            server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    attempts++;
                    if (attempts < maxAttempts) {
                        const nextPort = portToTry + 1;
                        console.log(`⚠️ Port ${portToTry} is busy, trying ${nextPort}...`);
                        setTimeout(() => tryListen(nextPort), 1000);
                    } else {
                        console.error(`❌ Failed to start WebSocket server after ${maxAttempts} attempts`);
                        process.exit(1);
                    }
                } else {
                    console.error('WebSocket server error:', error);
                }
            });

            wss = server;
            console.log(`🔌 WebSocket Server running on port ${portToTry}`);
            
            // Update environment variable for token endpoint
            process.env.WS_PORT = portToTry;
            
        } catch (error) {
            console.error('Failed to create WebSocket server:', error);
            process.exit(1);
        }
    };
    
    tryListen(port);
};

// ==================== START SERVERS ====================
const HTTP_PORT = process.env.HTTP_PORT || 8081;
const WS_PORT = parseInt(process.env.WS_PORT) || 8080;

// Start HTTP server
const httpServer = app.listen(HTTP_PORT, () => {
    console.log(`🌐 HTTP Server running on port ${HTTP_PORT}`);
    console.log(`📡 Endpoints:`);
    console.log(`   POST /gettoken - Get WebSocket token`);
    console.log(`   GET  /health   - Health check`);
    console.log(`   GET  /stats    - Server statistics`);
});

httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ HTTP port ${HTTP_PORT} is already in use`);
        console.log(`💡 Try setting a different port: HTTP_PORT=8082 node server.js`);
        process.exit(1);
    } else {
        console.error('HTTP server error:', error);
        process.exit(1);
    }
});

// Start WebSocket server
startWebSocketServer(WS_PORT);

// Cleanup expired tokens every 30 seconds
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
        console.log(`🧹 Cleaned up ${expiredCount} expired tokens (Active: ${ACTIVE_TOKENS.size})`);
    }
}, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    // Close WebSocket connections
    if (wss) {
        wss.clients.forEach((client) => {
            client.close(1000, 'Server shutting down');
        });
        wss.close(() => {
            console.log('WebSocket server closed');
        });
    }
    
    // Close HTTP server
    httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
    
    // Force exit after 5 seconds
    setTimeout(() => {
        console.log('Forced exit');
        process.exit(1);
    }, 5000);
});

console.log(`\n✨ Server initialization complete`);
console.log(`💡 Usage: POST to http://localhost:${HTTP_PORT}/gettoken to get a WebSocket token\n`);

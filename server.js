const WebSocket = require('ws');
const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Token storage (in-memory for this example)
const validTokens = new Set();

// Generate tokens valid for entire session
function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  return token;
}

// HTTP endpoint to get initial token
app.post('/gettoken', (req, res) => {
  const token = generateToken();
  res.json({ token });
  console.log(`[Auth] Issued new session token: ${token}`);
});

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, `ws://${req.headers.host}`).searchParams.get('token');
  
  if (!validTokens.has(token)) {
    console.log(`[Auth] Rejected invalid token: ${token}`);
    return ws.close(4001, 'Invalid token');
  }

  console.log(`[WS] Client connected with valid token (${token.substring(0, 6)}...)`);

  // Heartbeat
  let isAlive = true;
  const heartbeatInterval = setInterval(() => {
    if (!isAlive) return ws.terminate();
    isAlive = false;
    ws.ping();
  }, 30000);

  ws.on('pong', () => {
    isAlive = true;
    console.log(`[WS] Received pong from ${token.substring(0, 6)}...`);
  });

  // Message handling
  ws.on('message', (message) => {
    if (message === 'ping') {
      ws.send('pong');
      return;
    }

    try {
      const data = JSON.parse(message);
      console.log(`[WS] Received data:`, data);
      // Broadcast to other clients if needed
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    console.log(`[WS] Client disconnected (${token.substring(0, 6)}...)`);
  });
});

// HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// WebSocket upgrade handler
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// server.js - WebSocket Server for Collaborative Canvas
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { RoomManager } = require('./rooms');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

// Initialize room manager
const roomManager = new RoomManager({
  maxOperationsPerRoom: 10000,
  roomCleanupInterval: 60000,
  roomInactiveTimeout: 300000
});

// Message types
const MSG_TYPES = {
  JOIN: 'join',
  LEAVE: 'leave',
  OPERATION: 'operation',
  SYNC_REQUEST: 'sync_request',
  SYNC_RESPONSE: 'sync_response',
  USER_LIST: 'user_list',
  CURSOR_MOVE: 'cursor_move',
  ERROR: 'error'
};

// WebSocket connection handler
wss.on('connection', (ws) => {
  let currentUser = null;
  let currentRoom = null;

  console.log('New WebSocket connection');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case MSG_TYPES.JOIN:
          handleJoin(ws, message);
          break;
        
        case MSG_TYPES.OPERATION:
          handleOperation(message);
          break;
        
        case MSG_TYPES.SYNC_REQUEST:
          handleSyncRequest(ws);
          break;
        
        case MSG_TYPES.CURSOR_MOVE:
          handleCursorMove(message);
          break;
        
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      sendError(ws, error.message);
    }
  });

  ws.on('close', () => {
    handleLeave();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Handler functions
  function handleJoin(ws, message) {
    const { roomId, userId, userName, userColor } = message;
    
    if (!roomId || !userId) {
      sendError(ws, 'Missing roomId or userId');
      return;
    }

    currentRoom = roomManager.getRoom(roomId);
    currentUser = { 
      id: userId, 
      userName: userName || `User_${userId.substr(0, 6)}`, 
      userColor: userColor || '#000000' 
    };
    
    // Add user to room
    currentRoom.addUser(userId, ws, currentUser);
    
    // Send current state to new user
    ws.send(JSON.stringify({
      type: MSG_TYPES.SYNC_RESPONSE,
      operations: currentRoom.getActiveOperations(),
      users: currentRoom.getUserList()
    }));
    
    // Notify others about new user
    currentRoom.broadcast({
      type: MSG_TYPES.USER_LIST,
      users: currentRoom.getUserList()
    }, userId);

    console.log(`User ${userName} (${userId}) joined room ${roomId}`);
  }

  function handleOperation(message) {
    if (!currentRoom || !currentUser) {
      sendError(ws, 'Not in a room');
      return;
    }
    
    const operation = message.operation;
    
    // Validate operation belongs to current user
    if (operation.userId !== currentUser.id) {
      sendError(ws, 'Operation userId mismatch');
      return;
    }

    try {
      // Add operation to room history
      currentRoom.addOperation(operation);
      
      // Update user activity
      currentRoom.updateUserActivity(currentUser.id);
      
      // Broadcast to all other users
      const sentCount = currentRoom.broadcast({
        type: MSG_TYPES.OPERATION,
        operation
      }, currentUser.id);

      console.log(`Operation ${operation.type} from ${currentUser.userName} broadcasted to ${sentCount} users`);
    } catch (error) {
      console.error('Error handling operation:', error);
      sendError(ws, error.message);
    }
  }

  function handleSyncRequest(ws) {
    if (!currentRoom) {
      sendError(ws, 'Not in a room');
      return;
    }
    
    ws.send(JSON.stringify({
      type: MSG_TYPES.SYNC_RESPONSE,
      operations: currentRoom.getActiveOperations(),
      users: currentRoom.getUserList()
    }));

    console.log(`Sync request from ${currentUser?.userName || 'unknown'}`);
  }

  function handleCursorMove(message) {
    if (!currentRoom || !currentUser) return;
    
    // Update user activity
    currentRoom.updateUserActivity(currentUser.id);
    
    // Broadcast cursor position to others (throttled on client side)
    currentRoom.broadcast({
      type: MSG_TYPES.CURSOR_MOVE,
      userId: currentUser.id,
      userName: currentUser.userName,
      userColor: currentUser.userColor,
      position: message.position
    }, currentUser.id);
  }

  function handleLeave() {
    if (!currentRoom || !currentUser) return;
    
    console.log(`User ${currentUser.userName} left room ${currentRoom.id}`);
    
    const isEmpty = currentRoom.removeUser(currentUser.id);
    
    // Notify others
    if (!isEmpty) {
      currentRoom.broadcast({
        type: MSG_TYPES.USER_LIST,
        users: currentRoom.getUserList()
      });
    }
    
    // Room cleanup is handled by RoomManager's automatic cleanup
  }

  function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: MSG_TYPES.ERROR,
        message
      }));
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = roomManager.getAllStats();
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    ...stats
  });
});

// Stats endpoint
app.get('/stats', (req, res) => {
  res.json(roomManager.getAllStats());
});

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('Shutting down server...');
  
  roomManager.shutdown();
  
  wss.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
  console.log(`Open http://localhost:${PORT} to start drawing`);
});
// main.js - Application initialization and coordination

import { CanvasManager } from './canvas.js';
import WebSocketClient from './websocket.js';

// Configuration
const WS_URL = `ws://${window.location.host}`;
const ROOM_ID = 'default';
const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
];

// Generate user info
const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
const userName = `User ${Math.floor(Math.random() * 1000)}`;
const userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

// Initialize components
let canvasManager;
let wsClient;
let remoteCursors = new Map();

// DOM elements
const canvas = document.getElementById('canvas');
const colorPicker = document.getElementById('colorPicker');
const colorValue = document.getElementById('colorValue');
const brushSize = document.getElementById('brushSize');
const sizeValue = document.getElementById('sizeValue');
const brushBtn = document.getElementById('brushBtn');
const eraserBtn = document.getElementById('eraserBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const clearBtn = document.getElementById('clearBtn');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const userCount = document.getElementById('userCount');
const userIndicator = document.getElementById('userIndicator');

// Initialize application
async function init() {
  // Create canvas manager
  canvasManager = new CanvasManager(canvas);
  canvasManager.setUser(userId, userColor);
  
  // Set up canvas callbacks
  canvasManager.onOperationComplete = (operation) => {
    if (wsClient && wsClient.isConnected()) {
      wsClient.sendOperation(operation);
    }
  };

  // Set up WebSocket
  wsClient = new WebSocketClient(WS_URL, {
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onSync: handleSync,
    onOperation: handleRemoteOperation,
    onUserList: handleUserList,
    onCursorMove: handleCursorMove,
    onError: handleError
  });

  // Connect to server
  try {
    await wsClient.connect(ROOM_ID, userId, userName, userColor);
  } catch (error) {
    console.error('Failed to connect:', error);
    updateStatus(false, 'Connection failed');
  }

  // Set up event listeners
  setupEventListeners();
  
  // Set user indicator color
  userIndicator.querySelector('.user-dot').style.backgroundColor = userColor;
}

// Event listeners
function setupEventListeners() {
  // Canvas events
  canvas.addEventListener('mousedown', (e) => {
    canvasManager.startDrawing(e);
  });

  canvas.addEventListener('mousemove', (e) => {
    canvasManager.draw(e);
    
    // Send cursor position (throttled by WebSocket client)
    if (wsClient && wsClient.isConnected()) {
      const pos = canvasManager.getMousePos(e);
      throttledCursorUpdate(pos);
    }
  });

  canvas.addEventListener('mouseup', () => {
    canvasManager.stopDrawing();
  });

  canvas.addEventListener('mouseleave', () => {
    canvasManager.stopDrawing();
  });

  // Tool buttons
  brushBtn.addEventListener('click', () => {
    setTool('brush');
  });

  eraserBtn.addEventListener('click', () => {
    setTool('eraser');
  });

  // Color picker
  colorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    canvasManager.setColor(color);
    colorValue.textContent = color;
  });

  // Brush size
  brushSize.addEventListener('input', (e) => {
    const size = parseInt(e.target.value);
    canvasManager.setBrushSize(size);
    sizeValue.textContent = size;
  });

  // Action buttons
  undoBtn.addEventListener('click', () => {
    const undoOp = canvasManager.undo();
    if (undoOp && wsClient && wsClient.isConnected()) {
      wsClient.sendOperation(undoOp);
    }
    updateActionButtons();
  });

  redoBtn.addEventListener('click', () => {
    const redoOp = canvasManager.redo();
    if (redoOp && wsClient && wsClient.isConnected()) {
      wsClient.sendOperation(redoOp);
    }
    updateActionButtons();
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Clear the entire canvas? This affects all users.')) {
      const clearOp = canvasManager.clear();
      if (wsClient && wsClient.isConnected()) {
        wsClient.sendOperation(clearOp);
      }
      updateActionButtons();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redoBtn.click();
      } else {
        undoBtn.click();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      clearBtn.click();
    }
  });
}

// Tool selection
function setTool(tool) {
  canvasManager.setTool(tool);
  
  brushBtn.classList.toggle('active', tool === 'brush');
  eraserBtn.classList.toggle('active', tool === 'eraser');
  
  colorPicker.disabled = tool === 'eraser';
}

// WebSocket handlers
function handleConnect() {
  updateStatus(true, 'Connected');
  console.log('Connected to server');
}

function handleDisconnect() {
  updateStatus(false, 'Disconnected');
  console.log('Disconnected from server');
}

function handleSync(operations, users) {
  console.log('Received sync:', operations.length, 'operations');
  canvasManager.syncOperations(operations);
  handleUserList(users);
  updateActionButtons();
}

function handleRemoteOperation(operation) {
  console.log('Received operation:', operation.type);
  canvasManager.addOperation(operation);
  canvasManager.redrawCanvas();
  updateActionButtons();
}

function handleUserList(users) {
  // Filter out current user
  const otherUsers = users.filter(u => u.id !== userId);
  userCount.textContent = otherUsers.length + 1;
  
  // Update remote cursors
  const currentIds = new Set(otherUsers.map(u => u.id));
  
  // Remove cursors for users who left
  remoteCursors.forEach((cursor, id) => {
    if (!currentIds.has(id)) {
      cursor.remove();
      remoteCursors.delete(id);
    }
  });
}

function handleCursorMove(userId, userName, userColor, position) {
  let cursor = remoteCursors.get(userId);
  
  if (!cursor) {
    cursor = createCursorElement(userName, userColor);
    remoteCursors.set(userId, cursor);
  }
  
  // Convert canvas coordinates to screen coordinates
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / rect.height;
  
  cursor.style.left = `${rect.left + position.x * scaleX}px`;
  cursor.style.top = `${rect.top + position.y * scaleY}px`;
}

function handleError(error) {
  console.error('WebSocket error:', error);
}

// Cursor management
function createCursorElement(name, color) {
  const cursor = document.createElement('div');
  cursor.className = 'remote-cursor';
  
  const icon = document.createElement('div');
  icon.className = 'remote-cursor-icon';
  icon.style.backgroundColor = color;
  
  const nameLabel = document.createElement('div');
  nameLabel.className = 'remote-cursor-name';
  nameLabel.textContent = name;
  
  cursor.appendChild(icon);
  cursor.appendChild(nameLabel);
  document.getElementById('remoteCursors').appendChild(cursor);
  
  return cursor;
}

// Throttle cursor updates
let lastCursorSent = 0;
const CURSOR_THROTTLE = 50; // ms

function throttledCursorUpdate(position) {
  const now = Date.now();
  if (now - lastCursorSent > CURSOR_THROTTLE) {
    wsClient.sendCursorMove(position);
    lastCursorSent = now;
  }
}

// UI updates
function updateStatus(connected, text) {
  statusIcon.className = `status-icon ${connected ? 'connected' : 'disconnected'}`;
  statusIcon.textContent = connected ? '🟢' : '🔴';
  statusText.textContent = text;
}

function updateActionButtons() {
  undoBtn.disabled = !canvasManager.canUndo();
  redoBtn.disabled = !canvasManager.canRedo();
}

// Start the application
init();
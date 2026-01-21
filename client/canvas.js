// canvas.js - Canvas drawing logic

export class CanvasManager {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.isDrawing = false;
    this.currentPath = [];
    this.operations = [];
    this.undoneOperations = [];
    this.operationId = 0;
    
    // Drawing settings
    this.color = '#000000';
    this.brushSize = 3;
    this.tool = 'brush';
    
    // User info
    this.userId = null;
    this.userColor = null;
    
    // Callbacks
    this.onOperationComplete = null;
    this.onPathUpdate = null;
    
    this.setupCanvas();
  }

  setupCanvas() {
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;
  }

  setUser(userId, userColor) {
    this.userId = userId;
    this.userColor = userColor;
  }

  setTool(tool) {
    this.tool = tool;
  }

  setColor(color) {
    this.color = color;
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  getMousePos(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  startDrawing(event) {
    this.isDrawing = true;
    const pos = this.getMousePos(event);
    this.currentPath = [pos];
  }

  draw(event) {
    if (!this.isDrawing) return;

    const pos = this.getMousePos(event);
    this.currentPath.push(pos);

    // Draw immediate feedback
    if (this.currentPath.length >= 2) {
      const prevPos = this.currentPath[this.currentPath.length - 2];
      this.drawSegment(prevPos, pos, this.color, this.brushSize, this.tool);
    }

    // Notify about path update (for batching to server)
    if (this.onPathUpdate && this.currentPath.length % 3 === 0) {
      this.onPathUpdate(this.currentPath);
    }
  }

  stopDrawing() {
    if (!this.isDrawing || this.currentPath.length === 0) {
      this.isDrawing = false;
      return;
    }

    this.isDrawing = false;

    // Create operation
    const operation = {
      id: `${this.userId}_${this.operationId++}`,
      type: 'draw',
      userId: this.userId,
      userColor: this.userColor,
      path: [...this.currentPath],
      color: this.color,
      brushSize: this.brushSize,
      tool: this.tool,
      timestamp: Date.now()
    };

    // Add to local history
    this.addOperation(operation);

    // Clear current path
    this.currentPath = [];

    // Notify callback
    if (this.onOperationComplete) {
      this.onOperationComplete(operation);
    }
  }

  drawSegment(from, to, color, size, tool) {
    this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
    this.ctx.lineWidth = size;
    this.ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';

    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();

    this.ctx.globalCompositeOperation = 'source-over';
  }

  drawPath(path, color, size, tool) {
    if (path.length < 2) return;

    this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
    this.ctx.lineWidth = size;
    this.ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';

    this.ctx.beginPath();
    this.ctx.moveTo(path[0].x, path[0].y);

    for (let i = 1; i < path.length; i++) {
      this.ctx.lineTo(path[i].x, path[i].y);
    }

    this.ctx.stroke();
    this.ctx.globalCompositeOperation = 'source-over';
  }

  addOperation(operation) {
    if (operation.type === 'draw') {
      this.operations.push(operation);
      this.undoneOperations = []; // Clear redo stack
    } else if (operation.type === 'clear') {
      this.operations.push(operation);
      this.undoneOperations = [];
    } else if (operation.type === 'undo') {
      // Mark operation as undone
      const targetOp = this.operations.find(op => op.id === operation.targetOpId);
      if (targetOp) {
        targetOp.undone = true;
      }
    } else if (operation.type === 'redo') {
      // Unmark operation as undone
      const targetOp = this.operations.find(op => op.id === operation.targetOpId);
      if (targetOp) {
        targetOp.undone = false;
      }
    }
  }

  undo() {
    // Find last non-undone operation
    const lastOpIndex = this.operations.findLastIndex(op => !op.undone);
    if (lastOpIndex === -1) return null;

    const lastOp = this.operations[lastOpIndex];
    lastOp.undone = true;

    // Create undo operation
    const undoOp = {
      id: `undo_${this.userId}_${Date.now()}`,
      type: 'undo',
      targetOpId: lastOp.id,
      userId: this.userId,
      timestamp: Date.now()
    };

    this.redrawCanvas();
    return undoOp;
  }

  redo() {
    // Find first undone operation
    const firstUndoneIndex = this.operations.findIndex(op => op.undone);
    if (firstUndoneIndex === -1) return null;

    const firstUndone = this.operations[firstUndoneIndex];
    firstUndone.undone = false;

    // Create redo operation
    const redoOp = {
      id: `redo_${this.userId}_${Date.now()}`,
      type: 'redo',
      targetOpId: firstUndone.id,
      userId: this.userId,
      timestamp: Date.now()
    };

    this.redrawCanvas();
    return redoOp;
  }

  clear() {
    const clearOp = {
      id: `clear_${this.userId}_${Date.now()}`,
      type: 'clear',
      userId: this.userId,
      timestamp: Date.now()
    };

    this.operations.push(clearOp);
    this.undoneOperations = [];
    this.redrawCanvas();

    return clearOp;
  }

  redrawCanvas() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Replay all non-undone operations
    for (const op of this.operations) {
      if (op.undone) continue;

      if (op.type === 'draw') {
        this.drawPath(op.path, op.color, op.brushSize, op.tool);
      } else if (op.type === 'clear') {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  }

  syncOperations(operations) {
    // Replace operations with server state
    this.operations = operations.map(op => ({ ...op }));
    this.redrawCanvas();
  }

  canUndo() {
    return this.operations.some(op => !op.undone);
  }

  canRedo() {
    return this.operations.some(op => op.undone);
  }
}

// Helper to find last index
if (!Array.prototype.findLastIndex) {
  Array.prototype.findLastIndex = function(predicate) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate(this[i], i, this)) {
        return i;
      }
    }
    return -1;
  };
}
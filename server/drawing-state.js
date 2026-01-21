// drawing-state.js - Canvas state and operation management

const OP_TYPES = {
  DRAW: 'draw',
  CLEAR: 'clear',
  UNDO: 'undo',
  REDO: 'redo'
};

/**
 * Manages drawing operations and state
 */
class OperationManager {
  constructor() {
    this.operations = [];
    this.operationIndex = new Map(); // operationId -> array index
    this.userOperations = new Map(); // userId -> [operationIds]
  }

  /**
   * Add an operation to the history
   */
  addOperation(operation) {
    if (!this.validateOperation(operation)) {
      throw new Error('Invalid operation structure');
    }

    // Check for duplicate operations (idempotency)
    if (this.operationIndex.has(operation.id)) {
      console.warn(`Duplicate operation received: ${operation.id}`);
      return false;
    }

    switch (operation.type) {
      case OP_TYPES.DRAW:
        return this.addDrawOperation(operation);
      
      case OP_TYPES.CLEAR:
        return this.addClearOperation(operation);
      
      case OP_TYPES.UNDO:
        return this.handleUndo(operation);
      
      case OP_TYPES.REDO:
        return this.handleRedo(operation);
      
      default:
        console.error('Unknown operation type:', operation.type);
        return false;
    }
  }

  /**
   * Add a draw operation
   */
  addDrawOperation(operation) {
    const index = this.operations.length;
    this.operations.push({
      ...operation,
      undone: false,
      timestamp: operation.timestamp || Date.now()
    });

    this.operationIndex.set(operation.id, index);
    this.trackUserOperation(operation.userId, operation.id);

    return true;
  }

  /**
   * Add a clear operation
   */
  addClearOperation(operation) {
    const index = this.operations.length;
    this.operations.push({
      ...operation,
      undone: false,
      timestamp: operation.timestamp || Date.now()
    });

    this.operationIndex.set(operation.id, index);
    this.trackUserOperation(operation.userId, operation.id);

    return true;
  }

  /**
   * Handle undo operation
   */
  handleUndo(undoOperation) {
    const targetOpId = undoOperation.targetOpId;
    const targetIndex = this.operationIndex.get(targetOpId);

    if (targetIndex === undefined) {
      console.error('Undo target operation not found:', targetOpId);
      return false;
    }

    const targetOp = this.operations[targetIndex];
    
    if (targetOp.undone) {
      console.warn('Operation already undone:', targetOpId);
      return false;
    }

    // Mark as undone
    targetOp.undone = true;
    targetOp.undoneAt = Date.now();
    targetOp.undoneBy = undoOperation.userId;

    console.log(`Operation ${targetOpId} undone by ${undoOperation.userId}`);
    return true;
  }

  /**
   * Handle redo operation
   */
  handleRedo(redoOperation) {
    const targetOpId = redoOperation.targetOpId;
    const targetIndex = this.operationIndex.get(targetOpId);

    if (targetIndex === undefined) {
      console.error('Redo target operation not found:', targetOpId);
      return false;
    }

    const targetOp = this.operations[targetIndex];
    
    if (!targetOp.undone) {
      console.warn('Operation not undone, cannot redo:', targetOpId);
      return false;
    }

    // Unmark as undone
    targetOp.undone = false;
    delete targetOp.undoneAt;
    delete targetOp.undoneBy;

    console.log(`Operation ${targetOpId} redone by ${redoOperation.userId}`);
    return true;
  }

  /**
   * Track which operations belong to which users
   */
  trackUserOperation(userId, operationId) {
    if (!this.userOperations.has(userId)) {
      this.userOperations.set(userId, []);
    }
    this.userOperations.get(userId).push(operationId);
  }

  /**
   * Get all active (non-undone) operations
   */
  getActiveOperations() {
    return this.operations.filter(op => !op.undone);
  }

  /**
   * Get all operations (including undone)
   */
  getAllOperations() {
    return [...this.operations];
  }

  /**
   * Get operations by user
   */
  getUserOperations(userId) {
    const opIds = this.userOperations.get(userId) || [];
    return opIds
      .map(id => {
        const index = this.operationIndex.get(id);
        return this.operations[index];
      })
      .filter(op => op !== undefined);
  }

  /**
   * Get operation by ID
   */
  getOperation(operationId) {
    const index = this.operationIndex.get(operationId);
    return index !== undefined ? this.operations[index] : null;
  }

  /**
   * Get operation count
   */
  getOperationCount() {
    return this.operations.length;
  }

  /**
   * Get active operation count
   */
  getActiveOperationCount() {
    return this.operations.filter(op => !op.undone).length;
  }

  /**
   * Validate operation structure
   */
  validateOperation(operation) {
    if (!operation || typeof operation !== 'object') {
      return false;
    }

    // Required fields
    if (!operation.id || !operation.type || !operation.userId) {
      console.error('Missing required fields:', operation);
      return false;
    }

    // Type-specific validation
    switch (operation.type) {
      case OP_TYPES.DRAW:
        if (!operation.path || !Array.isArray(operation.path) || operation.path.length === 0) {
          console.error('Draw operation requires non-empty path array');
          return false;
        }
        if (!operation.color || !operation.brushSize) {
          console.error('Draw operation requires color and brushSize');
          return false;
        }
        break;

      case OP_TYPES.UNDO:
      case OP_TYPES.REDO:
        if (!operation.targetOpId) {
          console.error('Undo/Redo operation requires targetOpId');
          return false;
        }
        break;

      case OP_TYPES.CLEAR:
        // Clear operations don't need additional validation
        break;

      default:
        console.error('Unknown operation type:', operation.type);
        return false;
    }

    return true;
  }

  /**
   * Get statistics about operations
   */
  getStats() {
    const stats = {
      total: this.operations.length,
      active: this.getActiveOperationCount(),
      undone: this.operations.filter(op => op.undone).length,
      byType: {},
      byUser: {}
    };

    // Count by type
    this.operations.forEach(op => {
      stats.byType[op.type] = (stats.byType[op.type] || 0) + 1;
    });

    // Count by user
    this.userOperations.forEach((ops, userId) => {
      stats.byUser[userId] = ops.length;
    });

    return stats;
  }

  /**
   * Prune old operations (keep only recent N operations)
   */
  pruneOperations(maxOperations = 10000) {
    if (this.operations.length <= maxOperations) {
      return 0;
    }

    const removeCount = this.operations.length - maxOperations;
    const removedOps = this.operations.splice(0, removeCount);

    // Update indices
    this.operationIndex.clear();
    this.operations.forEach((op, index) => {
      this.operationIndex.set(op.id, index);
    });

    // Update user operations
    const removedIds = new Set(removedOps.map(op => op.id));
    this.userOperations.forEach((ops, userId) => {
      const filtered = ops.filter(id => !removedIds.has(id));
      if (filtered.length === 0) {
        this.userOperations.delete(userId);
      } else {
        this.userOperations.set(userId, filtered);
      }
    });

    console.log(`Pruned ${removeCount} old operations`);
    return removeCount;
  }

  /**
   * Create a snapshot of current active operations
   */
  createSnapshot() {
    return {
      operations: this.getActiveOperations(),
      timestamp: Date.now(),
      operationCount: this.getOperationCount()
    };
  }

  /**
   * Restore from a snapshot
   */
  restoreFromSnapshot(snapshot) {
    if (!snapshot || !snapshot.operations) {
      throw new Error('Invalid snapshot');
    }

    this.clear();
    
    snapshot.operations.forEach(op => {
      this.addOperation(op);
    });

    console.log(`Restored ${snapshot.operations.length} operations from snapshot`);
  }

  /**
   * Clear all operations
   */
  clear() {
    this.operations = [];
    this.operationIndex.clear();
    this.userOperations.clear();
  }

  /**
   * Export operations to JSON
   */
  exportToJSON() {
    return JSON.stringify({
      operations: this.operations,
      stats: this.getStats(),
      exportedAt: Date.now()
    }, null, 2);
  }

  /**
   * Import operations from JSON
   */
  importFromJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      if (!data.operations || !Array.isArray(data.operations)) {
        throw new Error('Invalid JSON structure');
      }

      this.clear();
      
      data.operations.forEach(op => {
        this.addOperation(op);
      });

      console.log(`Imported ${data.operations.length} operations`);
      return true;
    } catch (error) {
      console.error('Failed to import operations:', error);
      return false;
    }
  }
}

/**
 * Helper functions for canvas state calculations
 */
class CanvasStateHelper {
  /**
   * Calculate bounding box for a path
   */
  static getPathBounds(path) {
    if (!path || path.length === 0) {
      return null;
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    path.forEach(point => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Check if two paths intersect
   */
  static pathsIntersect(path1, path2) {
    const bounds1 = this.getPathBounds(path1);
    const bounds2 = this.getPathBounds(path2);

    if (!bounds1 || !bounds2) {
      return false;
    }

    // Simple bounding box intersection check
    return !(
      bounds1.x + bounds1.width < bounds2.x ||
      bounds2.x + bounds2.width < bounds1.x ||
      bounds1.y + bounds1.height < bounds2.y ||
      bounds2.y + bounds2.height < bounds1.y
    );
  }

  /**
   * Optimize path by removing redundant points
   */
  static optimizePath(path, tolerance = 1.0) {
    if (!path || path.length <= 2) {
      return path;
    }

    const optimized = [path[0]];
    
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];

      // Calculate distance from current point to line between prev and next
      const distance = this.pointToLineDistance(curr, prev, next);

      if (distance > tolerance) {
        optimized.push(curr);
      }
    }

    optimized.push(path[path.length - 1]);
    return optimized;
  }

  /**
   * Calculate distance from point to line
   */
  static pointToLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
      return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
    }

    const t = Math.max(0, Math.min(1, (
      (point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy
    ) / lenSq));

    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;

    return Math.hypot(point.x - projX, point.y - projY);
  }
}

module.exports = {
  OperationManager,
  CanvasStateHelper,
  OP_TYPES
};
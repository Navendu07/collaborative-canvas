// rooms.js - Room management module

const { OperationManager } = require('./drawing-state');

class Room {
  constructor(id) {
    this.id = id;
    this.users = new Map();
    this.operationManager = new OperationManager();
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  /**
   * Add a user to the room
   */
  addUser(userId, ws, userData) {
    this.users.set(userId, {
      id: userId,
      ws,
      name: userData.userName || `User_${userId.substr(0, 6)}`,
      color: userData.userColor || '#000000',
      joinedAt: Date.now(),
      lastSeen: Date.now()
    });

    this.lastActivity = Date.now();
    console.log(`User ${userData.userName} joined room ${this.id}. Total users: ${this.users.size}`);
  }

  /**
   * Remove a user from the room
   * Returns true if room is now empty
   */
  removeUser(userId) {
    const user = this.users.get(userId);
    if (user) {
      console.log(`User ${user.name} left room ${this.id}`);
      this.users.delete(userId);
    }

    return this.users.size === 0;
  }

  /**
   * Get a user by ID
   */
  getUser(userId) {
    return this.users.get(userId);
  }

  /**
   * Update user's last seen timestamp
   */
  updateUserActivity(userId) {
    const user = this.users.get(userId);
    if (user) {
      user.lastSeen = Date.now();
      this.lastActivity = Date.now();
    }
  }

  /**
   * Get list of all users in the room
   */
  getUserList() {
    return Array.from(this.users.values()).map(user => ({
      id: user.id,
      name: user.name,
      color: user.color,
      joinedAt: user.joinedAt
    }));
  }

  /**
   * Get count of active users
   */
  getUserCount() {
    return this.users.size;
  }

  /**
   * Add an operation to the room's history
   */
  addOperation(operation) {
    this.operationManager.addOperation(operation);
    this.lastActivity = Date.now();
  }

  /**
   * Get all active operations
   */
  getActiveOperations() {
    return this.operationManager.getActiveOperations();
  }

  /**
   * Get complete operation history (including undone)
   */
  getAllOperations() {
    return this.operationManager.getAllOperations();
  }

  /**
   * Get operation count
   */
  getOperationCount() {
    return this.operationManager.getOperationCount();
  }

  /**
   * Broadcast a message to all users in the room
   */
  broadcast(message, excludeUserId = null) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    this.users.forEach((user) => {
      if (user.id !== excludeUserId && user.ws.readyState === 1) { // 1 = OPEN
        try {
          user.ws.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error(`Failed to send to user ${user.id}:`, error.message);
        }
      }
    });

    return sentCount;
  }

  /**
   * Send a message to a specific user
   */
  sendToUser(userId, message) {
    const user = this.users.get(userId);
    if (user && user.ws.readyState === 1) {
      try {
        user.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`Failed to send to user ${userId}:`, error.message);
        return false;
      }
    }
    return false;
  }

  /**
   * Check if room has been inactive
   */
  isInactive(timeoutMs = 300000) { // 5 minutes default
    return Date.now() - this.lastActivity > timeoutMs;
  }

  /**
   * Get room statistics
   */
  getStats() {
    return {
      id: this.id,
      userCount: this.users.size,
      operationCount: this.operationManager.getOperationCount(),
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      ageMs: Date.now() - this.createdAt
    };
  }

  /**
   * Clean up room resources
   */
  cleanup() {
    // Close all user connections
    this.users.forEach(user => {
      if (user.ws.readyState === 1) {
        user.ws.close(1000, 'Room closed');
      }
    });

    this.users.clear();
    this.operationManager.clear();
    console.log(`Room ${this.id} cleaned up`);
  }
}

class RoomManager {
  constructor(options = {}) {
    this.rooms = new Map();
    this.maxOperationsPerRoom = options.maxOperationsPerRoom || 10000;
    this.roomCleanupInterval = options.roomCleanupInterval || 60000; // 1 minute
    this.roomInactiveTimeout = options.roomInactiveTimeout || 300000; // 5 minutes

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Get or create a room
   */
  getRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      const room = new Room(roomId);
      this.rooms.set(roomId, room);
      console.log(`Created new room: ${roomId}`);
    }
    return this.rooms.get(roomId);
  }

  /**
   * Check if a room exists
   */
  hasRoom(roomId) {
    return this.rooms.has(roomId);
  }

  /**
   * Delete a room
   */
  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.cleanup();
      this.rooms.delete(roomId);
      console.log(`Deleted room: ${roomId}`);
      return true;
    }
    return false;
  }

  /**
   * Get list of all room IDs
   */
  getRoomIds() {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get room count
   */
  getRoomCount() {
    return this.rooms.size;
  }

  /**
   * Get total user count across all rooms
   */
  getTotalUserCount() {
    let total = 0;
    this.rooms.forEach(room => {
      total += room.getUserCount();
    });
    return total;
  }

  /**
   * Get statistics for all rooms
   */
  getAllStats() {
    const stats = {
      roomCount: this.rooms.size,
      totalUsers: this.getTotalUserCount(),
      rooms: []
    };

    this.rooms.forEach(room => {
      stats.rooms.push(room.getStats());
    });

    return stats;
  }

  /**
   * Clean up inactive rooms
   */
  cleanupInactiveRooms() {
    const roomsToDelete = [];

    this.rooms.forEach((room, roomId) => {
      // Delete if empty and inactive
      if (room.getUserCount() === 0 && room.isInactive(this.roomInactiveTimeout)) {
        roomsToDelete.push(roomId);
      }
      // Warn if operation count is high
      else if (room.getOperationCount() > this.maxOperationsPerRoom) {
        console.warn(`Room ${roomId} has ${room.getOperationCount()} operations (max: ${this.maxOperationsPerRoom})`);
      }
    });

    roomsToDelete.forEach(roomId => {
      this.deleteRoom(roomId);
    });

    if (roomsToDelete.length > 0) {
      console.log(`Cleaned up ${roomsToDelete.length} inactive rooms`);
    }
  }

  /**
   * Start periodic cleanup of inactive rooms
   */
  startCleanupInterval() {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupInactiveRooms();
    }, this.roomCleanupInterval);

    console.log(`Room cleanup interval started (every ${this.roomCleanupInterval}ms)`);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanupInterval() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      console.log('Room cleanup interval stopped');
    }
  }

  /**
   * Shutdown - cleanup all rooms and stop intervals
   */
  shutdown() {
    console.log('Shutting down RoomManager...');
    this.stopCleanupInterval();

    this.rooms.forEach((room, roomId) => {
      this.deleteRoom(roomId);
    });

    console.log('RoomManager shutdown complete');
  }
}

module.exports = {
  Room,
  RoomManager
};
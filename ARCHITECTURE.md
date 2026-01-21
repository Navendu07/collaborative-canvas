# Collaborative Canvas Architecture

## System Overview

This is a real-time collaborative drawing application that allows multiple users to draw simultaneously on the same canvas with synchronization, conflict resolution, and global undo/redo functionality.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │   Canvas    │───▶│   Drawing    │───▶│   Operation    │  │
│  │  Renderer   │    │   Engine     │    │   Manager      │  │
│  └─────────────┘    └──────────────┘    └────────────────┘  │
│         │                   │                     │          │
│         │                   │                     │          │
│         └───────────────────┴─────────────────────┘          │
│                             │                                │
│                    ┌────────▼─────────┐                      │
│                    │   WebSocket      │                      │
│                    │     Client       │                      │
│                    └────────┬─────────┘                      │
└─────────────────────────────┼─────────────────────────────────┘
                              │
                    WebSocket Connection
                              │
┌─────────────────────────────▼─────────────────────────────────┐
│                       Server Layer                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  WebSocket   │───▶│     Room     │───▶│   Operation   │  │
│  │   Handler    │    │   Manager    │    │    History    │  │
│  └──────────────┘    └──────────────┘    └───────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┤
│  │            Broadcast Engine                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Drawing Event Flow

```
User Action (Mouse Move)
    │
    ▼
Canvas Event Handler
    │
    ▼
Generate Path Points { x, y }
    │
    ▼
Immediate Local Render (Optimistic Update)
    │
    ▼
Batch Path Points (every 3 points)
    │
    ▼
Send to WebSocket Client
    │
    ▼
WebSocket → Server
    │
    ▼
Server: Add to Operation History
    │
    ▼
Broadcast to Other Clients
    │
    ▼
Remote Clients: Receive & Render
```

### 2. Operation Synchronization Flow

```
New User Joins
    │
    ▼
Send JOIN message with user info
    │
    ▼
Server: Add user to room
    │
    ▼
Server: Send SYNC_RESPONSE
    │   ├─ Complete operation history
    │   └─ Current user list
    │
    ▼
Client: Replay all operations
    │
    ▼
Client: Ready to draw
```

## WebSocket Protocol

### Message Types

#### Client → Server

**JOIN**
```json
{
  "type": "join",
  "roomId": "room_123",
  "userId": "user_abc",
  "userName": "John Doe",
  "userColor": "#FF6B6B"
}
```

**OPERATION**
```json
{
  "type": "operation",
  "operation": {
    "id": "user_abc_42",
    "type": "draw",
    "userId": "user_abc",
    "path": [{"x": 100, "y": 150}, ...],
    "color": "#000000",
    "brushSize": 3,
    "tool": "brush",
    "timestamp": 1234567890
  }
}
```

**CURSOR_MOVE**
```json
{
  "type": "cursor_move",
  "position": {"x": 200, "y": 300}
}
```

#### Server → Client

**SYNC_RESPONSE**
```json
{
  "type": "sync_response",
  "operations": [...],
  "users": [...]
}
```

**OPERATION** (Broadcast)
```json
{
  "type": "operation",
  "operation": {...}
}
```

**USER_LIST**
```json
{
  "type": "user_list",
  "users": [
    {"id": "user_1", "name": "Alice", "color": "#FF6B6B"},
    {"id": "user_2", "name": "Bob", "color": "#4ECDC4"}
  ]
}
```

## Undo/Redo Strategy

### Global Operation History

The system maintains a **centralized operation log** on the server with these characteristics:

1. **Operation Ordering**: All operations have timestamps and IDs
2. **Soft Delete**: Undo doesn't remove operations, just marks them as `undone: true`
3. **Redo Support**: Redo unmarks the undone flag

### Implementation Details

```javascript
// Operation structure
{
  id: "user_123_42",           // Unique identifier
  type: "draw",                // draw, undo, redo, clear
  userId: "user_123",          // Who created it
  timestamp: 1234567890,       // When it was created
  undone: false,               // Is it currently undone?
  
  // Type-specific data
  path: [...],                 // For draw operations
  targetOpId: "user_456_30"    // For undo/redo operations
}
```

### Undo/Redo Process

**Undo Operation:**
1. Client pops last operation from local history
2. Creates UNDO operation referencing the undone operation ID
3. Sends to server
4. Server marks target operation as `undone: true`
5. Broadcasts undo to all clients
6. All clients redraw from active operations

**Redo Operation:**
1. Client pops last undone operation
2. Creates REDO operation referencing the redone operation ID
3. Sends to server
4. Server marks target operation as `undone: false`
5. Broadcasts redo to all clients
6. All clients redraw from active operations

### Conflict Resolution

**Scenario**: User A undoes User B's drawing

```
Initial State:
- Op1: User A draws line
- Op2: User B draws circle
- Op3: User A draws triangle

User A Undos (wants to undo triangle):
- Op4: Undo(Op3) created
- Op3 marked as undone
- Canvas redraws: Op1, Op2 visible

This is fair because:
- Each user can undo their own last action
- Global undo maintains temporal order
- No operations are lost (soft delete)
```

## Performance Optimizations

### 1. Path Batching

Instead of sending every mouse move event:

```javascript
// Bad: Send every point (100+ msgs/sec)
onMouseMove(e) {
  const point = getPoint(e);
  ws.send({ point });
}

// Good: Batch points (30-40 msgs/sec)
onMouseMove(e) {
  const point = getPoint(e);
  pathBuffer.push(point);
  
  if (pathBuffer.length >= 3) {  // Batch size
    ws.send({ path: pathBuffer });
    pathBuffer = [];
  }
}
```

### 2. Optimistic Updates

```javascript
// Draw immediately on local canvas
drawPath(localPath);

// Then send to server
ws.send(operation);

// Server broadcasts to others only
// No need to redraw local user's strokes
```

### 3. Efficient Canvas Redrawing

```javascript
// Only redraw when necessary
function redrawCanvas() {
  ctx.clearRect(0, 0, width, height);
  
  // Only draw active (not undone) operations
  const activeOps = operations.filter(op => !op.undone);
  
  activeOps.forEach(op => {
    if (op.type === 'draw') {
      drawPath(op.path, op.color, op.brushSize);
    } else if (op.type === 'clear') {
      ctx.clearRect(0, 0, width, height);
    }
  });
}
```

### 4. Cursor Position Throttling

```javascript
let lastCursorSent = 0;
const CURSOR_THROTTLE = 50; // ms

onMouseMove(e) {
  const now = Date.now();
  if (now - lastCursorSent > CURSOR_THROTTLE) {
    ws.sendCursorMove(position);
    lastCursorSent = now;
  }
}
```

## Conflict Resolution Strategies

### 1. Last-Write-Wins (LWW)

For drawing operations, we use timestamp-based ordering:

```javascript
if (opA.timestamp < opB.timestamp) {
  // opB drawn on top
}
```

### 2. Operational Transformation (Not Implemented)

For future enhancement, OT could transform operations:

```
User A: Draw at (100, 100)
User B: Draw at (100, 100) simultaneously

Transform: Offset B's operation slightly
Result: Both visible, slightly offset
```

### 3. Clear Operations

Clear is a global operation that:
- Creates a new operation in history
- Doesn't delete previous operations (for undo)
- Acts as a visual "barrier" when redrawing

## Scalability Considerations

### Current Limitations

- **In-Memory Storage**: Operations stored in RAM (lost on restart)
- **Single Server**: No horizontal scaling
- **No Persistence**: Canvas lost when all users leave

### Scaling to 1000+ Users

**Horizontal Scaling:**
```
┌─────────┐    ┌─────────┐    ┌─────────┐
│ Server  │    │ Server  │    │ Server  │
│   1     │    │   2     │    │   3     │
└────┬────┘    └────┬────┘    └────┬────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
              ┌─────▼─────┐
              │   Redis   │
              │  Pub/Sub  │
              └───────────┘
```

**Database Integration:**
```javascript
// Persist operations to database
async function addOperation(op) {
  await db.operations.insert(op);
  await redis.publish('room:' + roomId, op);
}

// Load on user join
async function syncUser(userId) {
  const ops = await db.operations
    .find({ roomId, undone: false })
    .sort({ timestamp: 1 });
  return ops;
}
```

**Canvas Snapshots:**
```javascript
// Take snapshot every N operations
if (operations.length % 100 === 0) {
  await saveSnapshot(canvasImageData);
}

// Load from snapshot + delta
const snapshot = await loadLatestSnapshot();
const deltaOps = await loadOperationsSince(snapshot.timestamp);
```

## Error Handling

### Network Disconnection

```javascript
class WebSocketClient {
  onclose() {
    // Exponential backoff reconnection
    attempts++;
    setTimeout(() => {
      this.reconnect();
    }, Math.min(1000 * Math.pow(2, attempts), 30000));
  }
  
  onReconnect() {
    // Request full sync
    this.requestSync();
  }
}
```

### Operation Conflicts

```javascript
// If operation ID already exists
if (operationIndex.has(op.id)) {
  console.warn('Duplicate operation received');
  return; // Idempotent - ignore duplicates
}
```

### Invalid Operations

```javascript
// Validate operation structure
function validateOperation(op) {
  if (!op.id || !op.type || !op.userId) {
    throw new Error('Invalid operation structure');
  }
  
  if (op.type === 'draw' && (!op.path || op.path.length === 0)) {
    throw new Error('Draw operation requires path');
  }
}
```

## Testing Strategy

### Unit Tests
- Operation history management
- Undo/redo logic
- Path batching
- Message serialization

### Integration Tests
- WebSocket connection lifecycle
- Multi-user synchronization
- Conflict resolution scenarios

### Load Tests
```javascript
// Simulate 100 concurrent users
for (let i = 0; i < 100; i++) {
  const client = new WebSocketClient();
  await client.connect();
  simulateDrawing(client);
}
```

## Future Enhancements

1. **Layers**: Multiple drawing layers with z-index
2. **Shapes**: Rectangle, circle, line tools
3. **Text**: Text annotation support
4. **Images**: Image import and manipulation
5. **Persistence**: Save/load sessions from database
6. **Authentication**: User accounts and permissions
7. **Rooms**: Multiple isolated canvas rooms
8. **Chat**: Built-in chat for collaboration
9. **Export**: Save as PNG, SVG, PDF
10. **Mobile**: Touch support for mobile devices
// websocket.js - Client-side WebSocket management

class WebSocketClient {
  constructor(url, callbacks = {}) {
    this.url = url;
    this.ws = null;
    this.callbacks = callbacks;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isIntentionalClose = false;
  }

  connect(roomId, userId, userName, userColor) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          
          // Join room
          this.send({
            type: 'join',
            roomId,
            userId,
            userName,
            userColor
          });
          
          if (this.callbacks.onConnect) {
            this.callbacks.onConnect();
          }
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket disconnected');
          
          if (this.callbacks.onDisconnect) {
            this.callbacks.onDisconnect();
          }

          // Attempt reconnection if not intentional
          if (!this.isIntentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            
            setTimeout(() => {
              this.connect(roomId, userId, userName, userColor);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          if (this.callbacks.onError) {
            this.callbacks.onError(error);
          }
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'sync_response':
        if (this.callbacks.onSync) {
          this.callbacks.onSync(message.operations, message.users);
        }
        break;

      case 'operation':
        if (this.callbacks.onOperation) {
          this.callbacks.onOperation(message.operation);
        }
        break;

      case 'user_list':
        if (this.callbacks.onUserList) {
          this.callbacks.onUserList(message.users);
        }
        break;

      case 'cursor_move':
        if (this.callbacks.onCursorMove) {
          this.callbacks.onCursorMove(
            message.userId,
            message.userName,
            message.userColor,
            message.position
          );
        }
        break;

      case 'error':
        console.error('Server error:', message.message);
        if (this.callbacks.onError) {
          this.callbacks.onError(new Error(message.message));
        }
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    console.warn('WebSocket not connected, message not sent');
    return false;
  }

  sendOperation(operation) {
    return this.send({
      type: 'operation',
      operation
    });
  }

  sendCursorMove(position) {
    return this.send({
      type: 'cursor_move',
      position
    });
  }

  requestSync() {
    return this.send({
      type: 'sync_request'
    });
  }

  disconnect() {
    this.isIntentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default WebSocketClient;
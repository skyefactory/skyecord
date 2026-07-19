import {WebSocketServer} from 'ws';
import validator from 'validator';
import dotenv from 'dotenv';
dotenv.config();
async function initRooms(signalingServer) {
    const response = await fetch('https://auth.skyefactory.com/room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operation:'get', secret: process.env.ROOM_LIST_SECRET })
    });

    if (!response.ok) {
        console.error(`Failed to fetch room list. Status: ${response.status}`);
        return;
    }

    const data = await response.json();
    if (!data.rooms || !Array.isArray(data.rooms)) {
        console.error('Invalid room list format received from auth server.');
        return;
    }

    for (const room of data.rooms) {
        if (room.roomId && room.roomName) {
            signalingServer.rooms.set(room.roomId, new Room(room.roomId, room.roomName));
            console.log(`Initialized room: ${room.roomName} with ID: ${room.roomId}`);
        } else {
            console.error('Invalid room data received:', room);
        }
    }
}

class Room{
    constructor(roomId, roomName){
        this.users = new Set(); // name => socket
        this.roomName = roomName; // name of the room displayed to the users
        this.roomId = roomId; // reference to the roomID.
    }

    //broadcasts a websocket message to all users in the room, excluding the specified websocket if provided
    broadcastToRoom(message, excludeWs = null) {
        for(const ws of this.users.values()) {
            if(ws !== excludeWs){
                ws.send(JSON.stringify(message));
            }
        }
    }
    //returns the display name of all users in the room
    getUserList(){
        const userList = [];
        for (const ws of this.users.values()) {
            userList.push(ws.name);
        }
        return userList;
    }
}

class SignalingServer{
    constructor(port = 50420, maxPayload = 64 * 1024, maxConnections = 10) {
        this.port = port;
        this.maxPayload = maxPayload;

        this.maxConnections = maxConnections;
        this.connections = 0;

        this.authServer = 'https://auth.skyefactory.com/verify-session'; // URL of the auth server to verify session IDs
        this.roomOperations = 'https://auth.skyefactory.com/room'
        this.roomIdLength = 12; // length of the room ID string
        this.rooms = new Map(); // roomId => Room

        this.wss = new WebSocketServer({ port: this.port, maxPayload: this.maxPayload,});
        console.log(`Signaling server started on port ${this.port}`);

        this.wss.on('connection', (ws) => { // new connection received

            console.log('Client connected');
            signalingServer.connections++;

            // Make sure the server is not full.
            if (signalingServer.connections > signalingServer.maxConnections) {
                console.log('Maximum connections reached. Closing new connection.');
                ws.send(JSON.stringify({ type: 'error', message: 'Server is full. Try again later.' }));
                ws.close(1013, 'Server is full');
                return;
            }

            // Each client connection needs to be marked as alive to ensure that the connection is still active. This is done using a heartbeat mechanism.
            ws.isAlive = true;

            ws.on('pong', () => { // When a pong is received, mark the connection as alive
                ws.isAlive = true;
            });

            ws.on('message', async (message) => { // We received a message from a client.
                //check if this message is from the auth server to update the room list. If so, update the room list and return.
                try{
                    const data = this.parseMessage(message);
                    if(data && data.type === 'updateRoomList'){
                        console.log('Received room list update from auth server.');
                        const { roomId, roomName, secret, operation } = data;
                        if(!roomId || !roomName){
                            console.error('Invalid room list update received from auth server. Missing roomId or roomName.');
                            ws.close(1003, 'Invalid room list update');
                            return;
                        }
                        if(secret !== process.env.ROOM_LIST_SECRET){
                            console.error('Invalid secret provided for room list update.');
                            ws.close(1003, 'Invalid secret for room list update');
                            return;
                        }

                        if(operation === 'delete'){
                            if(signalingServer.rooms.has(roomId)){
                                // remove all users from the room before deleting it
                                const room = signalingServer.rooms.get(roomId);
                                for (const userWs of room.users) {
                                    userWs.send(JSON.stringify({ type: 'error', message: 'Room has been deleted by the server.' }));
                                    userWs.close(1003, 'Room deleted');
                                }
                                signalingServer.rooms.delete(roomId);
                                console.log(`Deleted room: ${roomName} with ID: ${roomId}`);
                            } else {
                                console.log(`Room with ID: ${roomId} does not exist. Skipping deletion.`);
                            }
                        } else if(!signalingServer.rooms.has(roomId)){
                            signalingServer.rooms.set(roomId, new Room(roomId, roomName));
                            console.log(`Added new room: ${roomName} with ID: ${roomId}`);
                        } else {
                            console.log(`Room with ID: ${roomId} already exists. Skipping addition.`);
                            ws.close(1003, 'Room already exists');
                        }
                        return;
                    }
                } catch (error) {
                    console.error('Error processing message from auth server:', error);
                }

                // If the message is not from the auth server, process it as a client message.

                // Parse the message and check if it is valid JSON. If not, close the connection.
                let data = signalingServer.parseMessage(message);
                if (!data){
                    console.log('Received invalid JSON message from client. Closing connection.');
                    ws.close(1003, 'Invalid JSON message');
                    return;
                }

                if(!ws.user){
                    // If the user has never been authenticated, we need to authenticate them.
                    const sessionId = data.sessionId;
                    if (!sessionId || typeof sessionId !== 'string') {
                        console.error('Invalid session ID provided for authentication.');
                        ws.close(1008, 'You must log in.');
                        return;
                    }

                    const user = await signalingServer.isAuthenticated(sessionId);
                    if (!user) {
                        console.log("Received message from unauthenticated user.");
                        ws.close(1008, "You must log in.");
                        return;
                    }

                    // Store the authenticated user information in the WebSocket object for future reference
                    ws.user = user;
                }

                switch (data.type) {
                    case 'join':
                        this.joinRoom(ws, data.name, data.roomId);
                        break;
                    case 'offer':
                        signalingServer.processOffer(ws, data);
                        break;
                    case 'ice-candidate':
                        signalingServer.processIceCandidate(ws, data);
                        break;
                    default:
                        console.log('Received message from client with unknown type: ' + data.type);
                        ws.close(1003, 'Unknown message type');
                        return;
                }
            });
            ws.on('close', (code, reason) => {
                signalingServer.processDisconnect(ws, code, reason);
            });
        });

        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log(`Terminating inactive client: ${ws.name || 'Unknown'}`);
                    return ws.terminate(); // Forcefully close the connection
                }

                ws.isAlive = false;
                ws.ping(); 
            });
        }, 30000);

        this.logInterval = setInterval(() => {
            for (const [roomId, room] of this.rooms.entries()) {
                console.log(`Room ID: ${roomId}, Room Name: ${room.roomName}, Users: ${room.getUserList()}`);
            }
            
        }, 60000);

        this.wss.on('close', () => {
            this.connections--;
            clearInterval(this.heartbeatInterval);
            clearInterval(this.logInterval);
            console.log("Shutting down server and clearing intervals.");
        });
    }

    generateRoomId(){
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < this.roomIdLength; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    roomNameCollision(roomName){
        for (const room of this.rooms.values()) {
            if (room.roomName === roomName) {
                return true; // Collision found
            }
        }
        return false; // No collision
    }

    createNewRoom(ws, roomName){
        if(ws.room){
            console.error(`User ${ws.name} attempted to create a new room while already in room ${ws.room}`);
            ws.send(JSON.stringify({ type: 'room-create-result', message: 'You are already in a room' }));
            return null;
        }
        if (this.roomNameCollision(roomName)) {
            console.error(`Room name '${roomName}' is already in use.`);
            ws.send(JSON.stringify({ type: 'room-create-result', message: 'Room name already in use' }));
            return null;
        }
        const roomId = this.generateRoomId();
        const newRoom = new Room(roomId, roomName);
        this.rooms.set(roomId, newRoom);
        console.log(`Created new room: ${roomName} with ID: ${roomId}`);
        return roomId;
    }
    
    parseMessage(message){
        try{
            return JSON.parse(message);
        } catch (error) {
            console.error('Error parsing message:', error);
            return null;
        }
    }

    sanitizeName(rawName){
        if (typeof rawName !== 'string') return 'Anonymous';
  
        // Trim white spaces and limit length to prevent memory buffer exhaustion attacks
        let cleanName = validator.trim(rawName).slice(0, 32);
        
        // Convert <, >, &, ", ', and / into safe HTML entities
        return validator.escape(cleanName);
    }

    async isAuthenticated(sessionId){
        if (!sessionId || typeof sessionId !== 'string') {
            console.error('Invalid session ID provided for authentication.');
            return null;
        }
        try{
            const response = await fetch(this.authServer, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sessionId })
            });
            if (!response.ok) {
                console.error(`Auth server responded with status: ${response.status}`);
                return null;
            }
            const data = await response.json();
            return data.user
        } catch (error) {
            console.error('Error during authentication request:', error);
            return null;
        }
    }

    doesRoomExist(roomId){
        return this.rooms.has(roomId);
    }

    isNameTaken(roomId, name){
        const room = this.rooms.get(roomId);
        if (!room) {
            console.error(`Room with ID ${roomId} does not exist.`);
            return false;
        }
        for (const user of room.users.values()) {
            if(user.name === name){
                return true; // Name is taken
            }
        }
        return false; // Name is available
    }

    joinRoom(ws, name, roomId){
        name = this.sanitizeName(name);
        if (name.length < 1 || name.length > 32) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid username' }));
            console.error(`User ${name} attempted to join with invalid username`);
            ws.close(1003, 'Invalid username');
            return;
        }
        if(!ws.user){
            ws.send(JSON.stringify({ type: 'error', message: 'You must be logged in to join a room.' }));
            console.error(`Unauthenticated user attempted to join room ${roomId}`);
            ws.close(1008, 'You must log in.');
            return;
        }
        if(ws.name){
            ws.close(1008, "Already joined");
            return;
        }
        if(!this.doesRoomExist(roomId)){
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
            console.log(`User ${name} attempted to join with invalid room ID: ${roomId}`);
            ws.close(1003, 'Invalid room ID');
            return;
        }
        if(this.isNameTaken(roomId, name)){
            ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
            console.log(`User ${name} attempted to join but username is already taken`);
            ws.close(1003, 'Username already taken');
            return;
        }
        const room = this.rooms.get(roomId);
        ws.room = roomId;
        ws.name = name;
        room.users.add(ws);
        console.log(`User ${name} joined the room ${room.roomName}`);
        ws.send(JSON.stringify({ type: 'joined', roomId: roomId, roomName: room.roomName, users: room.getUserList(), numusers: room.users.size }));
        room.broadcastToRoom({ type: 'user_change', users: room.getUserList(), numusers: room.users.size }, ws);

    }

    processOffer(ws, data) {
        if (!ws.name) {
            ws.close(1008, "Must join first");
            return;
        }
        if (!ws.user){
            ws.close(1008, "Must be logged in");
            return;
        }
        if(typeof data.target !== "string" || typeof data.description !== "object"){
            ws.close(1003, "Invalid offer format");
            return;
        }
        if(data.description.type !== "offer" && data.description.type !== "answer") {
            ws.close(1003, "Invalid SDP type");
            return;
        }
        if(!data.roomId || typeof data.roomId !== "string") {
            ws.close(1003, "Invalid room ID");
            return;
        }
        const room = this.rooms.get(data.roomId);
        if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
            console.error(`User ${ws.name} attempted to send an offer to a non-existent room: ${data.roomId}`);
            ws.close(1003, 'Room not found');
            return;
        }

        for (const user of room.users) {
            if (user.name === data.target) {
                const target = user;
                console.log(`Forwarding ${data.description.type} from ${ws.name} to ${data.target}`);
                target.send(JSON.stringify({ type: 'offer', description: data.description, from: ws.name }));
                return;
            }
            else {
                console.log(`Offer target ${data.target} not found in room ${data.roomId}`);
            }
        }

    }

    processIceCandidate(ws, data) {
        if (!ws.name) {
            ws.close(1008, "Must join first");
            return;
        }
        if (!ws.user){
            ws.close(1008, "Must be logged in");
            return;
        }
        if(typeof data.target !== "string" || typeof data.candidate !== "object"){
            ws.close(1003, "Invalid ICE candidate format");
            return;
        }
        if(!data.roomId || typeof data.roomId !== "string") {
            ws.close(1003, "Invalid room ID");
            return;
        }
        const room = this.rooms.get(data.roomId);
        if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
            console.error(`User ${ws.name} attempted to send an ICE candidate to a non-existent room: ${data.roomId}`);
            ws.close(1003, 'Room not found');
            return;
        }

        for (const user of room.users) {
            if (user.name === data.target) {
                const target = user;
                console.log(`Forwarding ICE candidate from ${ws.name} to ${data.target}`);
                target.send(JSON.stringify({ type: 'ice-candidate', candidate: data.candidate, from: ws.name }));
                return;
            }
            else {
                console.log(`ICE candidate target ${data.target} not found in room ${data.roomId}`);
            }
        }
    }

    processDisconnect(ws, code, reason) {
        this.connections--;
        if (!ws.user) {
            console.log('A user disconnected before joining the room.');
            return;
        }
        const room = this.rooms.get(ws.room);
        if (room) {
            room.users.delete(ws);
            console.log(`User ${ws.name} left the room ${room.roomName}`);
            room.broadcastToRoom({ type: 'user_change', users: room.getUserList(), numusers: room.users.size });    
        } 
        else {
            console.log(`User ${ws.name} disconnected but was not in a valid room.`);
        }
        if (reason === ""){
            reason = "disconnected";
        }
        console.log(`Client disconnected. Code: ${code}, Reason: ${reason}`);
    }

};

const signalingServer = new SignalingServer(50420, 64 * 1024, 10); // Create a new signaling server instance
initRooms(signalingServer).then(() => {
    console.log('Room initialization complete.');
}).catch((error) => {
    console.error('Error during room initialization:', error);
});
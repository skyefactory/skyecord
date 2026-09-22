/*
message format:
{
    "type": "messageType",
    "data": {
        "key": "value"
    },
    "from": "senderId", (optional)
    "to": "receiverId" (optional)
}
*/
import validator from 'validator';
import {WebSocketServer} from "ws";
import { RoomManager } from "./roomManager.ts";
import { generatePeerID } from "./peerID.ts";
import * as types from "./types.ts";



class SignalServer{
    public wss: WebSocketServer;
    public roomManager: RoomManager = new RoomManager();
    private serverPort: number = 50420;
    private maxPayload: number = 64*1024;
    private maxConnections: number = 10;
    private connectionCount: number = 0;
    private verifySessionAPIUrl: string = 'https://auth.skyefactory.com/verify-session'

    constructor(){
        this.wss = new WebSocketServer({
            port: this.serverPort,
            maxPayload: this.maxPayload
        });

        this.wss.on("connection", (ws: types.SkyecordWebSocket) => this.handleNewConnection(ws));
        console.log(`Signal server is running on port ${this.serverPort}`);
        console.log('Waiting for connections...');
    }

    async verifySession(sessionID: string): Promise<boolean>{
        try{
            const response = await fetch(this.verifySessionAPIUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sessionID })
            });

            if(!response.ok){
                console.error("Failed to verify session. Status:", response.status);
                return false;
            }

            const result = await response.json();
            return result.user !== undefined && result.user !== null;
        } catch(e){
            console.error("Error verifying session:", e);
            return false;
        }
    }

    handleNewConnection(ws: types.SkyecordWebSocket){
        if(this.connectionCount >= this.maxConnections){
            ws.close(1001, "Server is full");
            return;
        }
        ws.on("close", () => {
            this.connectionCount--;
            console.log('Connection closed. Current connections:', this.connectionCount, '/', this.maxConnections);
        });

        this.connectionCount++;
        console.log('New connection established. Current connections:', this.connectionCount, '/', this.maxConnections);
    
        ws.isAlive = true;
        ws.on("pong", () => {
            ws.isAlive = true;
        });

        ws.on("message", async (message: string) => this.handleMessage(ws, message));
        ws.on("close", () => this.handleDisconnection(ws));
    }

    parseMessage(message: JSON | string){
        if(typeof message === "string"){
            try{
                return JSON.parse(message);
            }catch(e){
                console.error("Failed to parse message:", e);
                return null;
            }
        }else{
            return message;
        }
    }

    async handleMessage(ws: types.SkyecordWebSocket, message: string){
        const parsedMessage = this.parseMessage(message);
        if(!parsedMessage) return;

        const { type, data, to } = parsedMessage;
        if(data.roomSecret){
            // this is a connection from the db server.
            // verify the room secret and handle accordingly.s
        }
        if(!ws.sessionID){
            // this user has not yet been authenticated.
            const sentSessionID = data.sessionID;
            if(!sentSessionID){
                ws.close(1008, "Login required.");
                return;
            }
            const isValidSession = await this.verifySession(sentSessionID);
            if(!isValidSession){
                ws.close(1008, "Login required.");
                return;
            }

            ws.sessionID = sentSessionID;
        }

        switch(type){
            case 'joinRoom':{
                this.joinRoom(ws, data.roomID, data.username);
                break;
            }
            case 'sdp':{
                this.forwardSDP(ws, data.description, to);
                break;
            }
            case 'iceCandidate':{
                this.forwardICECandidate(ws, data.candidate, to);
                break;
            }
            case 'updateUsername':{
                // Handle username update logic
                break;
            }
            default:{
                console.warn("Unknown message type:", type);
            }
        }
    }
    sanitizeUsername(rawUsername: string): string{
        let cleanUsername: string = validator.trim(rawUsername).slice(0,32);
        return validator.escape(cleanUsername);
    }
    validateDescription(description: any): boolean{
        if(!description || typeof description !== 'object') return false;
        if(!description.type) return false;
        if(!description.type.startsWith('offer') && !description.type.startsWith('answer')) return false;
        return true;
    }
    validateICECandidate(candidate: any): boolean{
        if(!candidate || typeof candidate !== 'object') return false;
        return true;
    }
    validateSocket(ws: types.SkyecordWebSocket): boolean{
        if(!ws.sessionID) return false;
        if(!ws.peerID) return false;
        if(!ws.roomID) return false;
        return true;
    }
    joinRoom(ws: types.SkyecordWebSocket, roomID: types.roomID, username: string){
        if(!this.roomManager.doesRoomExist(roomID)){
            ws.send(JSON.stringify({type: "error", data: "Room does not exist."}));
            ws.close(1008, "Room does not exist.");
            return;
        }
        username = this.sanitizeUsername(username);
        if(username.length < 1){
            ws.send(JSON.stringify({type: "error", data: "Username cannot be empty."}));
            ws.close(1008, "Invalid username.");
        }
        if(ws.peerID || ws.roomID){
            ws.send(JSON.stringify({type: "error", data: "You are already in a room."}));
            ws.close(1008, "Already in a room.");
            return;
        }
        const peerID = generatePeerID();
        const success = this.roomManager.addUserToRoom(roomID, peerID, ws, username);
        if(!success){
            ws.send(JSON.stringify({type: "error", data: "Failed to join room. Username may be taken."}));
            ws.close(1008, "Failed to join room.");
            return;
        }
        ws.peerID = peerID;
        ws.roomID = roomID;
        ws.send(JSON.stringify({type: "joinedRoom", data: {peerID, username}}));
    }
    forwardSDP(ws: types.SkyecordWebSocket, description:any, to: types.peerID){
        if(!this.validateSocket(ws)){
            ws.send(JSON.stringify({type: "error", data: "You are not in a room."}));
            ws.close(1008, "You are not in a room.");
            return;
        }
        if(!this.roomManager.doesRoomExist(ws.roomID as types.roomID)){
            ws.send(JSON.stringify({type: "error", data: "Room does not exist."}));
            ws.close(1008, "Room does not exist.");
            return;
        }
        
        const room = this.roomManager.getRoom(ws.roomID as types.roomID);
        if(!room) return;

        const descriptionIsValid = this.validateDescription(description);

        if(!descriptionIsValid){
            ws.send(JSON.stringify({type: "error", data: "Invalid SDP description."}));
            ws.close(1008, "Invalid SDP description.");
            return;
        }


        const targetUser = room.roomUsers.get(to);
        if(!targetUser){
            ws.send(JSON.stringify({type: "error", data: "Target user not found in room."}));
            return;
        }

        targetUser.socket.send(JSON.stringify({type: "sdp", }));
    }
    forwardICECandidate(ws: types.SkyecordWebSocket, candidate:any,  to: types.peerID){
        if(!ws.roomID || !ws.peerID){
            ws.send(JSON.stringify({type: "error", data: "You are not in a room."}));
            ws.close(1008, "You are not in a room.");
            return;
        }
        if(!this.roomManager.doesRoomExist(ws.roomID)){
            ws.send(JSON.stringify({type: "error", data: "Room does not exist."}));
            ws.close(1008, "Room does not exist.");
            return;
        }
        const candidateIsValid = this.validateICECandidate(candidate);
        if(!candidateIsValid){
            ws.send(JSON.stringify({type: "error", data: "Invalid ICE candidate."}));
            ws.close(1008, "Invalid ICE candidate.");
            return;
        }
        const room = this.roomManager.getRoom(ws.roomID);
        if(!room) return;
        const targetUser = room.roomUsers.get(to);
        if(!targetUser){
            ws.send(JSON.stringify({type: "error", data: "Target user not found in room."}));
            return;
        }
        targetUser.socket.send(JSON.stringify({type: "iceCandidate", data: {candidate, from: ws.peerID}}));
    }
    updateUsername(ws: types.SkyecordWebSocket, newUsername: string){
        if(!ws.roomID || !ws.peerID){
            ws.send(JSON.stringify({type: "error", data: "You are not in a room."}));
            ws.close(1008, "You are not in a room.");
            return;
        }
        if(!this.roomManager.doesRoomExist(ws.roomID)){
            ws.send(JSON.stringify({type: "error", data: "Room does not exist."}));
            ws.close(1008, "Room does not exist.");
            return;
        }
        newUsername = this.sanitizeUsername(newUsername);
        if(newUsername.length < 1){
            ws.send(JSON.stringify({type: "error", data: "Username cannot be empty."}));
            ws.close(1008, "Invalid username.");
            return;
        }
        const room = this.roomManager.getRoom(ws.roomID);
        if(!room) return;
        if(this.roomManager.isUsernameTaken(ws.roomID, newUsername)){
            ws.send(JSON.stringify({type: "error", data: "Username is already taken in this room."}));
            return;
        }
        const userConnection = room.roomUsers.get(ws.peerID);
        if(!userConnection){
            ws.send(JSON.stringify({type: "error", data: "User not found in room."}));
            return;
        }
        userConnection.username = newUsername;
        room.broadcastMessage(JSON.stringify({type: "usernameUpdated", data: {peerID: ws.peerID, newUsername}}), ws.peerID, true);
    }
    handleDisconnection(ws: types.SkyecordWebSocket){
        if(!ws.roomID || !ws.peerID) return;
        if(!this.roomManager.doesRoomExist(ws.roomID)) return;

        const room = this.roomManager.getRoom(ws.roomID);
        if(!room) return;

        const userConnection = room.roomUsers.get(ws.peerID);
        if(!userConnection) return;

        this.roomManager.removeUserFromRoom(ws.roomID, ws.peerID);
    }
};

let server: SignalServer = new SignalServer();
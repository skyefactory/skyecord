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
import ws, { WebSocketServer } from "ws";
import { RoomManager, peerID, roomID, UserConnection } from "./room.js";
import WebSocket from "ws";

export interface SkyecordWebSocket extends WebSocket {
  isAlive: boolean;
  sessionID?: string;
}

export class SignalServer{
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

        this.wss.on("connection", (ws: SkyecordWebSocket) => this.handleNewConnection(ws));
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

    handleNewConnection(ws: SkyecordWebSocket){
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

    async handleMessage(ws: SkyecordWebSocket, message: string){
        const parsedMessage = this.parseMessage(message);
        if(!parsedMessage) return;

        const { type, data, from, to } = parsedMessage;

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
                this.joinRoom(ws, data.roomID, data.username, from);
                break;
            }
            case 'sdp':{
                this.forwardSDP(ws, data.description, data.roomID, from, to);
                break;
            }
            case 'iceCandidate':{
                this.forwardICECandidate(ws, data.candidate, data.roomID, from, to);
                // Handle ICE candidate logic
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
    joinRoom(ws: SkyecordWebSocket, roomID: roomID, username: string, peerID: peerID){
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
        this.roomManager.addUserToRoom(roomID, peerID, ws, username);
    }
    forwardSDP(ws: SkyecordWebSocket, description:any, roomID: roomID, from: peerID, to: peerID){
        if(!this.roomManager.doesRoomExist(roomID)){
            ws.send(JSON.stringify({type: "error", data: "Room does not exist."}));
            ws.close(1008, "Room does not exist.");
            return;
        }
        if(!this.roomManager.isUserInRoom(roomID, from)){
            ws.send(JSON.stringify({type: "error", data: "You are not in this room."}));
            ws.close(1008, "You are not in this room.");
            return;
        }
        const descriptionIsValid = this.validateDescription(description);
        if(!descriptionIsValid){
            ws.send(JSON.stringify({type: "error", data: "Invalid SDP description."}));
            ws.close(1008, "Invalid SDP description.");
            return;
        }
        const room = this.roomManager.getRoom(roomID);
        if(!room) return;
        const targetUser = room.roomUsers.get(to);
        if(!targetUser){
            ws.send(JSON.stringify({type: "error", data: "Target user not found in room."}));
            return;
        }
        targetUser.socket.send(JSON.stringify({type: "sdp", data: {description, from}}));
    }
    forwardICECandidate(ws: SkyecordWebSocket, candidate:any, roomID: roomID, from: peerID, to: peerID){
        if(!this.roomManager.doesRoomExist(roomID)){
            ws.send(JSON.stringify({type: "error", data: "Room does not exist."}));
            ws.close(1008, "Room does not exist.");
            return;
        }
        if(!this.roomManager.isUserInRoom(roomID, from)){
            ws.send(JSON.stringify({type: "error", data: "You are not in this room."}));
            ws.close(1008, "You are not in this room.");
            return;
        }
        const candidateIsValid = this.validateICECandidate(candidate);
        if(!candidateIsValid){
            ws.send(JSON.stringify({type: "error", data: "Invalid ICE candidate."}));
            ws.close(1008, "Invalid ICE candidate.");
            return;
        }
        const room = this.roomManager.getRoom(roomID);
        if(!room) return;
        const targetUser = room.roomUsers.get(to);
        if(!targetUser){
            ws.send(JSON.stringify({type: "error", data: "Target user not found in room."}));
            return;
        }
        targetUser.socket.send(JSON.stringify({type: "iceCandidate", data: {candidate, from}}));
    }
    updateUsername(ws: SkyecordWebSocket, roomID: roomID, peerID: peerID, newUsername: string){}
    handleDisconnection(ws: SkyecordWebSocket, peerID: peerID, roomID: roomID){}

}
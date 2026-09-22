import type { roomID, peerID } from "./types.ts";
import { UserConnection } from "./userConnection.ts";


export class Room{
    public roomID: roomID;
    public roomName: string;
    public roomSalt: string;
    public roomUsers: Map<peerID, UserConnection> = new Map<peerID, UserConnection>();

    constructor(roomID: roomID, roomName: string, roomSalt: string){
        this.roomID = roomID;
        this.roomName = roomName;
        this.roomSalt = roomSalt;
    }

    broadcastMessage(message: string, senderID: peerID, excludeSender: boolean = false){
        this.roomUsers.forEach((userConnection: UserConnection, peerID: peerID) => {
            if(excludeSender && peerID === senderID) return;
            userConnection.socket.send(message);
        });
    }

    getUsersInRoom(): Array<{peerID: peerID, username: string}>{
        const users: Array<{peerID: peerID, username: string}> = [];
        this.roomUsers.forEach((userConnection: UserConnection, peerID: peerID) => {
            users.push({peerID, username: userConnection.username});
        });
        return users;
    }
}


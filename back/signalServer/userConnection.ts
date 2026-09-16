import { SkyecordWebSocket, peerID } from "./types.js";
export class UserConnection{
    public peerID: peerID;
    public socket: SkyecordWebSocket;
    public username: string;

    constructor(peerID: peerID,  socket: SkyecordWebSocket, username: string){
        this.peerID = peerID;
        this.socket = socket;
        this.username = username;
    }
}
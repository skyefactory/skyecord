    import { WebSocket } from "ws";
    import { SkyecordWebSocket } from "./signalServer.js";
    export class UserConnection{
        public peerID: string;
        public socket: SkyecordWebSocket;
        public username: string;

        constructor(peerID: string,  socket: SkyecordWebSocket, username: string){
            this.peerID = peerID;
            this.socket = socket;
            this.username = username;
        }
    }

    export type peerID = string;
    export type roomID = string;
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

    export class RoomManager{
        public rooms: Map<roomID, Room> = new Map<roomID, Room>();
        public roomDBUrl: string = "https://auth.skyefactory.com/room";

        addNewRoom(roomID: roomID, roomName: string, roomSalt: string): Room{
            const newRoom = new Room(roomID, roomName, roomSalt);
            this.rooms.set(roomID, newRoom);
            return newRoom;
        }

        getRoom(roomID: roomID): Room | undefined{
            return this.rooms.get(roomID);
        }

        doesRoomExist(roomID: roomID): boolean{
            return this.rooms.has(roomID);
        }

        isUserInRoom(roomID: roomID, peerID: peerID): boolean{
            const room = this.getRoom(roomID);
            if(!room) return false;
            return room.roomUsers.has(peerID);
        }

        isUsernameTaken(roomID: roomID, username: string): boolean{
            const room = this.getRoom(roomID);
            if(!room) return false;
            for(const userConnection of room.roomUsers.values()){
                if(userConnection.username === username) return true;
            }
            return false;
        }

        isRoomEmpty(roomID: roomID): boolean{
            const room = this.getRoom(roomID);
            if(!room) return true;
            return room.roomUsers.size === 0;
        }

        deleteRoom(roomID: roomID){
            this.rooms.delete(roomID);
        }

        addUserToRoom(roomID: roomID, peerID: peerID, socket: SkyecordWebSocket, username: string): boolean{
            const room = this.getRoom(roomID);
            if(!room) return false;

            if(this.isUsernameTaken(roomID, username)) return false;
            if(this.isUserInRoom(roomID, peerID)) return false;

            const user = new UserConnection(peerID, socket, username);
            room.roomUsers.set(peerID, user);
            room.broadcastMessage(JSON.stringify({type: "userJoined", data: {peerID, username}}), peerID, true);
            socket.send(JSON.stringify({type: "roomUsers", data: {users: room.getUsersInRoom()}}));
            return true;
        }
    }
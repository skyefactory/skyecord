import type { SkyecordWebSocket,roomID, peerID } from "./types.ts";
import { UserConnection } from "./userConnection.ts";
import { Room } from "./room.ts";

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

        const user = new UserConnection(peerID, socket, username);
        room.roomUsers.set(peerID, user);
        room.broadcastMessage(JSON.stringify({type: "userJoined", data: {peerID, username}}), peerID, true);
        socket.send(JSON.stringify({type: "roomUsers", data: {users: room.getUsersInRoom()}}));
        return true;
    }

    removeUserFromRoom(roomID: roomID, peerID: peerID): boolean{
        const room = this.getRoom(roomID);
        if(!room) return false;

        const user = room.roomUsers.get(peerID);
        if(!user) return false;

        room.roomUsers.delete(peerID);
        room.broadcastMessage(JSON.stringify({type: "userLeft", data: {peerID}}), peerID, true);
        return true;
    }

    initializeRoomsFromDB(){
        //
    }
}
import {getSessionID, setSessionID} from "./utility.js";

const authServerURL = "https://auth.skyecord.com";

export async function login(username, password){
    const res = await fetch(`${authServerURL}/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({username, password})
    });

    if(res.ok){
        const data = await res.json();
        setSessionID(data.sessionId);
        return {success: true}
    } else{
        const errorData = await res.json();
        return {success: false, message: errorData.message}
    }
}
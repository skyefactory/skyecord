import {login} from "./auth.js";

const loginForm = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    
    try {
        const result = await login(username, password);
        if(result.success){
            window.location.href = "/dashboard.html";
        } else{
            errorMsg.textContent = result.message;
            password.value = "";
        }
    }
});
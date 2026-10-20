import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCnKUb63ZQVZv-xEV6EqyQcIGiShVhqyIE",
    authDomain: "my-passwords-4f228.firebaseapp.com",
    databaseURL: "https://my-passwords-4f228-default-rtdb.firebaseio.com",
    projectId: "my-passwords-4f228",
    storageBucket: "my-passwords-4f228.firebasestorage.app",
    messagingSenderId: "552762838636",
    appId: "1:552762838636:web:a33a5178267e1679a3d249"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
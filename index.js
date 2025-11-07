const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require("qrcode-terminal");

const TOKEN_PATH = path.join(__dirname, 'auth.token.json');
const AUTH_API_URL = 'http://localhost:4000';

function saveToken(obj) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(obj, null, 2), { encoding: 'utf8' });
}

function loadToken() {
    try {
        const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function setAuthHeader(token) {
    if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    else delete axios.defaults.headers.common['Authorization'];
}

// validate token function
function isTokenExpired(saved) {
    if (!saved || !saved.expiresIn || !saved.obtainedAt) return false;
    // expiresIn assumed seconds; convert to ms
    return (saved.obtainedAt + (saved.expiresIn * 1000)) < Date.now();
}

async function validateToken() {
    const saved = loadToken();
    if (!saved || !saved.token) return false;

    if (isTokenExpired(saved)) {
        // remove header and inform caller
        setAuthHeader(null);
        return false;
    }

    // set the token on the header
    setAuthHeader(saved.token);

    try {
        // call the api for validation
        await axios.get(AUTH_API_URL + '/validate');
        return true;
    } catch (err) {
        // invalid/expired token
        setAuthHeader(null);
        return false;
    }
}

// load token at startup
const saved = loadToken();
if (saved && saved.token) {
    setAuthHeader(saved.token);
}

// Create client with additional options for stability
const client = new Client({
    authStrategy: new LocalAuth()
});

// Event handlers
client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    console.log("QR code received, scan please!");
});

client.on("ready", () => {
    console.log("Client is ready!");
});

client.on("message", async (message) => {
    if (message.body.toLowerCase() === "ping") {
        message.reply("pong");
    } 
    else if (/^digimon\s+\w+$/i.test(message.body)) {
      console.log("digimon info")

        // validate token before making API calls
        if (!await validateToken()) {
            return message.reply('Please login first: use "login <password>"');
        }

        const digimonName = message.body.split(/\s+/)[1];
        const digimonUrl = `https://digimon-api.vercel.app/api/digimon/name/${digimonName}`;
        
        axios.get(digimonUrl)
            .then((response) => {
                const digimon = response.data[0];
                const caption = `*Name:* ${digimon.name}\n*Level:* ${digimon.level}`;
                axios.get(digimon.img, {
                  responseType: 'arraybuffer',
                })
                  .then((response) => {
                    const imageResponse = response.data;
                    const imageBuffer = Buffer.from(imageResponse, 'binary');
                    const imageBase64 = imageBuffer.toString('base64');
                    const imageMedia = new MessageMedia('image/jpeg', imageBase64, `{digimon.name}.jpg`);

                    return client.sendMessage(message.from, imageMedia, { caption: caption });
                  })
                  .catch((error) => {
                    console.error('Error fetching the image:', error);
                    return client.sendMessage(message.from, `I couldn't find that digimon :(.`);
                  });
            })
            .catch((error) => {
                console.error('Error fetching Digimon:', error);
                message.reply('Sorry, I couldn\'t find that Digimon');
            });
    } 
    else if (/^digimon\s+sticker\s+\w+$/i.test(message.body)) {
        console.log("digimon sticker")

        // validate token before making API calls
        if (!await validateToken()) {
            return message.reply('Please login first: use "login <password>"');
        }

        const digimonName = message.body.split(/\s+/)[2];
        const digimonUrl = `https://digimon-api.vercel.app/api/digimon/name/${digimonName}`;
        
        axios.get(digimonUrl)
            .then((response) => {
                const digimon = response.data[0];
                axios.get(digimon.img, {
                  responseType: 'arraybuffer',
                })
                  .then((response) => {
                    const imageResponse = response.data;
                    const imageBuffer = Buffer.from(imageResponse, 'binary');
                    const imageBase64 = imageBuffer.toString('base64');
                    const imageMedia = new MessageMedia('image/jpeg', imageBase64, `{digimon.name}.jpg`);

                    return client.sendMessage(message.from, imageMedia, { sendMediaAsSticker: true });
                  })
                  .catch((error) => {
                    console.error('Error fetching the image:', error);
                    return client.sendMessage(message.from, 'I couldn\'t find that digimon :(.');
                  });
            })
            .catch((error) => {
                console.error('Error fetching Digimon:', error);
                message.reply('Sorry, I couldn\'t find that Digimon');
            });
    } else if (/^register\s+\w+$/i.test(message.body)) {
        console.log("register command")

        if (message.body.split(/\s+/).length !== 2) return message.reply("Register failed: incorrect format.\nUse: register <password>");
        const pswrd = message.body.split(/\s+/)[1];

        // call auth API register endpoint
        axios.post(AUTH_API_URL + '/register', { username: message.from, password: pswrd })
            .then(res => {
                const token = res.data.token || res.data.jwt;
                if (!token) {
                    message.reply('Register succeeded but no token returned. Please login.');
                    return;
                }

                // save token and optional metadata
                saveToken({
                    token,
                    expiresIn: res.data.expiresIn || null
                });

                // set default auth header for future axios calls
                setAuthHeader(token);

                message.reply('Registration successful. Token saved and you are logged in.');
            })
            .catch(err => {
                console.error('Register error:', err.response?.data || err.message);
                // if API returns 409 or similar, forward message
                const apiMsg = err.response?.data?.message || 'Registration failed: authentication error.';
                message.reply(apiMsg);
            });
    } else if (/^login\s+\w+$/i.test(message.body)) {
        console.log("login command")
        
        if(message.body.split(/\s+/).length != 2) return message.reply("Login failed: incorrect format. \nUse: login <password>");
        const pswrd = message.body.split(/\s+/)[1];

        // call your auth API - replace URL and response field names as needed
        axios.post(AUTH_API_URL + '/login', { username: message.from,password: pswrd })
            .then(res => {
                // adjust to match your API response (res.data.token / res.data.jwt ...)
                const token = res.data.accessToken;
                if (!token) {
                    message.reply('Login failed: no token returned.');
                    return;
                }

                // save token and optional metadata
                saveToken({
                    token,
                    expiresIn: res.data.expiresIn || null
                });

                // set default auth header for future axios calls
                setAuthHeader(token);

                message.reply('Login successful. Token saved.');
            })
            .catch(err => {
                console.error('Auth error:', err.response?.data || err.message);
                message.reply('Login failed: authentication error.');
            });
    } 
});

// Initialize with error handling
client.initialize().catch(err => {
    console.error('Error initializing client:', err);
});
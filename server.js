const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL;

const REDIRECT_URI = `${BASE_URL}/callback`;

const SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing"
].join(" ");

const sessions = new Map();


// ======================================================
// PAGE PRINCIPALE
// ======================================================

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <title>Roblox Spotify</title>
            <style>
                body {
                    background: #121212;
                    color: white;
                    font-family: Arial, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }

                .box {
                    text-align: center;
                    padding: 40px;
                    background: #181818;
                    border-radius: 20px;
                }

                h1 {
                    color: #1ed760;
                }
            </style>
        </head>
        <body>
            <div class="box">
                <h1>♫ Roblox Spotify</h1>
                <p>Serveur Spotify opérationnel.</p>
            </div>
        </body>
        </html>
    `);
});


// ======================================================
// CRÉER UNE SESSION
// ======================================================

app.post("/auth/create", (req, res) => {

    const playerId = req.body?.playerId;

    if (!playerId) {
        return res.status(400).json({
            success: false,
            error: "playerId manquant."
        });
    }

    let code;

    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (sessions.has(code));

    sessions.set(code, {
        playerId: String(playerId),
        accessToken: null,
        refreshToken: null,
        connected: false,
        createdAt: Date.now()
    });

    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        state: code
    });

    const authUrl =
        "https://accounts.spotify.com/authorize?" +
        params.toString();

    console.log("Nouvelle session :", code);

    res.json({
        success: true,
        code,
        authUrl
    });
});


// ======================================================
// REDIRECTION VERS SPOTIFY
// ======================================================

app.get("/auth/:code", (req, res) => {

    const code = req.params.code;

    const session = sessions.get(code);

    if (!session) {
        return res.status(404).send("Session introuvable.");
    }

    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        state: code
    });

    res.redirect(
        "https://accounts.spotify.com/authorize?" +
        params.toString()
    );
});


// ======================================================
// CALLBACK SPOTIFY
// ======================================================

app.get("/callback", async (req, res) => {

    const { code, state, error } = req.query;

    if (error) {
        return res.send(`
            <h1>Connexion Spotify annulée</h1>
            <p>${error}</p>
        `);
    }

    if (!code || !state) {
        return res.status(400).send("Paramètres Spotify manquants.");
    }

    const session = sessions.get(state);

    if (!session) {
        return res.status(404).send("Session Roblox introuvable.");
    }

    try {

        const credentials =
            Buffer
                .from(`${CLIENT_ID}:${CLIENT_SECRET}`)
                .toString("base64");

        const response = await fetch(
            "https://accounts.spotify.com/api/token",
            {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${credentials}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: code,
                    redirect_uri: REDIRECT_URI
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            console.error(
                "Erreur token Spotify :",
                response.status,
                data
            );

            return res.status(500).send(`
                <h1>Erreur Spotify</h1>
                <p>Impossible de récupérer le token.</p>
            `);
        }

        session.accessToken = data.access_token;
        session.refreshToken = data.refresh_token;
        session.connected = true;
        session.createdAt = Date.now();

        console.log(
            "Spotify connecté pour la session :",
            state
        );

        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <title>Spotify connecté</title>
                <style>
                    body {
                        background: #121212;
                        color: white;
                        font-family: Arial, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }

                    .box {
                        background: #181818;
                        padding: 40px;
                        border-radius: 20px;
                        text-align: center;
                    }

                    h1 {
                        color: #1ed760;
                    }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>✓ Spotify connecté</h1>
                    <p>Ton compte Spotify est maintenant connecté à Roblox.</p>
                    <p>Tu peux fermer cette page.</p>
                </div>
            </body>
            </html>
        `);

    } catch (err) {

        console.error("Erreur callback :", err);

        res.status(500).send(`
            <h1>Erreur serveur</h1>
            <p>Une erreur est survenue pendant la connexion.</p>
        `);
    }
});


// ======================================================
// RAFRAÎCHIR LE TOKEN
// ======================================================

async function refreshAccessToken(session) {

    if (!session.refreshToken) {
        throw new Error("Refresh token manquant.");
    }

    const credentials =
        Buffer
            .from(`${CLIENT_ID}:${CLIENT_SECRET}`)
            .toString("base64");

    const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: session.refreshToken
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {

        console.error(
            "Erreur refresh token :",
            response.status,
            data
        );

        throw new Error(
            data.error_description ||
            "Impossible de rafraîchir le token."
        );
    }

    session.accessToken = data.access_token;

    if (data.refresh_token) {
        session.refreshToken = data.refresh_token;
    }

    return session.accessToken;
}


// ======================================================
// REQUÊTE SPOTIFY
// ======================================================

async function spotifyRequest(
    session,
    method,
    endpoint,
    body = null,
    retry = true
) {

    if (!session.accessToken) {
        throw new Error("Compte Spotify non connecté.");
    }

    const options = {
        method,
        headers: {
            "Authorization": `Bearer ${session.accessToken}`
        }
    };

    if (body !== null) {

        options.headers["Content-Type"] =
            "application/json";

        options.body = JSON.stringify(body);
    }

    let response = await fetch(
        "https://api.spotify.com/v1" + endpoint,
        options
    );

    // --------------------------------------------------
    // TOKEN EXPIRÉ
    // --------------------------------------------------

    if (response.status === 401 && retry) {

        console.log("Token Spotify expiré, refresh...");

        await refreshAccessToken(session);

        return spotifyRequest(
            session,
            method,
            endpoint,
            body,
            false
        );
    }

    // --------------------------------------------------
    // 204 = SUCCÈS SANS CONTENU
    // --------------------------------------------------

    if (response.status === 204) {

        return {
            status: 204,
            data: null
        };
    }

    // --------------------------------------------------
    // AUTRES RÉPONSES
    // --------------------------------------------------

    const text = await response.text();

    let data = null;

    if (text) {

        try {
            data = JSON.parse(text);
        } catch {
            data = {
                message: text
            };
        }
    }

    return {
        status: response.status,
        data
    };
}


// ======================================================
// STATUT DE CONNEXION
// ======================================================

app.get("/auth/status/:code", (req, res) => {

    const session = sessions.get(req.params.code);

    if (!session) {
        return res.json({
            success: false,
            connected: false,
            error: "Session introuvable."
        });
    }

    res.json({
        success: true,
        connected:
            Boolean(session.accessToken) &&
            Boolean(session.refreshToken)
    });
});


// ======================================================
// LECTURE ACTUELLE
// ======================================================

app.get("/player/:code", async (req, res) => {

    const session = sessions.get(req.params.code);

    if (!session) {
        return res.json({
            success: false,
            connected: false,
            error: "Session introuvable."
        });
    }

    if (!session.accessToken) {
        return res.json({
            success: true,
            connected: false
        });
    }

    try {

        const result = await spotifyRequest(
            session,
            "GET",
            "/me/player"
        );

        // ------------------------------------------------
        // AUCUNE MUSIQUE EN COURS
        // ------------------------------------------------

        if (result.status === 204) {

            return res.json({
                success: true,
                connected: true,
                playing: false,
                name: null,
                artist: null,
                position: 0,
                duration: 0,
                cover: null
            });
        }

        // ------------------------------------------------
        // ERREUR SPOTIFY
        // ------------------------------------------------

        if (result.status >= 400) {

            console.error(
                "Erreur /me/player :",
                result.status,
                result.data
            );

            if (result.status === 401) {
                session.connected = false;

                return res.json({
                    success: false,
                    connected: false,
                    error: "Session Spotify expirée."
                });
            }

            return res.status(502).json({
                success: false,
                connected: true,
                error:
                    result.data?.error?.message ||
                    "Spotify a refusé la requête."
            });
        }

        const data = result.data;

        // ------------------------------------------------
        // PAS DE TRACK
        // ------------------------------------------------

        if (!data || !data.item) {

            return res.json({
                success: true,
                connected: true,
                playing: false,
                name: null,
                artist: null,
                position: 0,
                duration: 0,
                cover: null
            });
        }

        const item = data.item;

        const artists =
            item.artists
                ?.map(a => a.name)
                .join(", ") ||
            "Artiste inconnu";

        const cover =
            item.album?.images?.[0]?.url ||
            null;

        res.json({
            success: true,
            connected: true,
            playing: Boolean(data.is_playing),

            name: item.name || "Musique inconnue",

            artist: artists,

            position:
                Number(data.progress_ms) || 0,

            duration:
                Number(item.duration_ms) || 0,

            cover
        });

    } catch (err) {

        console.error(
            "Erreur player :",
            err
        );

        res.status(500).json({
            success: false,
            connected: true,
            error: err.message
        });
    }
});


// ======================================================
// COMMANDES PLAY / PAUSE / NEXT / PREVIOUS
// ======================================================

app.post("/player/:action/:code", async (req, res) => {

    const action = req.params.action;
    const code = req.params.code;

    const session = sessions.get(code);

    if (!session) {
        return res.status(404).json({
            success: false,
            error: "Session introuvable."
        });
    }

    if (!session.accessToken) {
        return res.status(401).json({
            success: false,
            error: "Spotify non connecté."
        });
    }

    const commands = {

        play: {
            method: "PUT",
            endpoint: "/me/player/play"
        },

        pause: {
            method: "PUT",
            endpoint: "/me/player/pause"
        },

        next: {
            method: "POST",
            endpoint: "/me/player/next"
        },

        previous: {
            method: "POST",
            endpoint: "/me/player/previous"
        }
    };

    const command = commands[action];

    if (!command) {
        return res.status(400).json({
            success: false,
            error: "Commande inconnue."
        });
    }

    try {

        console.log(
            "Commande Spotify :",
            action,
            "session :",
            code
        );

        const result = await spotifyRequest(
            session,
            command.method,
            command.endpoint
        );

        // ------------------------------------------------
        // 204 = LA COMMANDE A RÉUSSI
        // ------------------------------------------------

        if (result.status === 204) {

            console.log(
                "Commande Spotify réussie :",
                action
            );

            return res.json({
                success: true,
                command: action
            });
        }

        // ------------------------------------------------
        // ERREUR PREMIUM
        // ------------------------------------------------

        if (result.status === 403) {

            console.error(
                "Spotify 403 :",
                result.data
            );

            return res.status(403).json({
                success: false,
                error:
                    "Spotify refuse cette commande. " +
                    "Le contrôle de lecture nécessite Spotify Premium."
            });
        }

        // ------------------------------------------------
        // AUTRE ERREUR
        // ------------------------------------------------

        if (result.status >= 400) {

            console.error(
                "Erreur commande Spotify :",
                result.status,
                result.data
            );

            return res.status(502).json({
                success: false,
                error:
                    result.data?.error?.message ||
                    "Spotify a refusé la commande."
            });
        }

        return res.json({
            success: true,
            command: action
        });

    } catch (err) {

        console.error(
            "Erreur commande :",
            err
        );

        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// ======================================================
// NETTOYAGE DES SESSIONS
// ======================================================

setInterval(() => {

    const now = Date.now();

    for (const [code, session] of sessions.entries()) {

        // Supprime les sessions non connectées depuis 10 min
        if (
            !session.connected &&
            now - session.createdAt > 10 * 60 * 1000
        ) {
            sessions.delete(code);

            console.log(
                "Session expirée :",
                code
            );
        }
    }

}, 60 * 1000);


// ======================================================
// SERVEUR
// ======================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("================================");
        console.log("Spotify Roblox Server démarré !");
        console.log("Port :", PORT);
        console.log("Base URL :", BASE_URL);
        console.log("Redirect URI :", REDIRECT_URI);
        console.log("================================");
    }
);

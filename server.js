import express from "express";
import crypto from "crypto";

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL;

if (!CLIENT_ID || !CLIENT_SECRET || !BASE_URL) {
    console.error("Variables manquantes !");
    console.error("SPOTIFY_CLIENT_ID");
    console.error("SPOTIFY_CLIENT_SECRET");
    console.error("BASE_URL");
    process.exit(1);
}

const REDIRECT_URI = `${BASE_URL}/callback`;

/*
==================================================
STOCKAGE TEMPORAIRE
==================================================

Pour commencer, les connexions sont gardées
en mémoire.

Si Render redémarre, les joueurs devront
se reconnecter.
*/

const sessions = new Map();

/*
==================================================
SCOPES SPOTIFY
==================================================
*/

const SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing"
].join(" ");

/*
==================================================
GÉNÉRER UN CODE
==================================================
*/

function generateCode() {
    return String(
        Math.floor(100000 + Math.random() * 900000)
    );
}

/*
==================================================
GÉNÉRER UN STATE OAUTH
==================================================
*/

function generateState() {
    return crypto.randomBytes(32).toString("hex");
}

/*
==================================================
PAGE D'ACCUEIL
==================================================
*/

app.get("/", (req, res) => {

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Roblox Spotify</title>

            <style>
                body {
                    background: #121212;
                    color: white;
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding-top: 100px;
                }

                h1 {
                    color: #1ed760;
                }
            </style>
        </head>

        <body>

            <h1>♫ Roblox Spotify</h1>

            <p>
                Serveur Spotify opérationnel.
            </p>

        </body>
        </html>
    `);
});

/*
==================================================
CRÉER UNE SESSION DE CONNEXION
==================================================

Roblox appellera cette route.

Elle donne :

- un code
- une URL Spotify
*/

app.post("/auth/create", (req, res) => {

    const playerId = req.body?.playerId;

    if (!playerId) {

        return res.status(400).json({
            success: false,
            error: "playerId manquant"
        });

    }

    let code;

    do {
        code = generateCode();
    } while (sessions.has(code));

    const state = generateState();

    sessions.set(code, {

        playerId: String(playerId),

        state: state,

        connected: false,

        accessToken: null,

        refreshToken: null,

        expiresAt: 0,

        createdAt: Date.now()

    });

    const params = new URLSearchParams({

        response_type: "code",

        client_id: CLIENT_ID,

        scope: SCOPES,

        redirect_uri: REDIRECT_URI,

        state: state,

        show_dialog: "true"

    });

    const spotifyUrl =
        "https://accounts.spotify.com/authorize?" +
        params.toString();

    res.json({

        success: true,

        code: code,

        url: spotifyUrl

    });
});

/*
==================================================
OUVRIR SPOTIFY
==================================================

Le joueur arrive sur :

https://tonserveur.onrender.com/auth/123456

*/

app.get("/auth/:code", (req, res) => {

    const code = req.params.code;

    const session = sessions.get(code);

    if (!session) {

        return res.status(404).send(`
            <h1>Code invalide</h1>
            <p>Ce code n'existe plus.</p>
        `);

    }

    if (Date.now() - session.createdAt > 10 * 60 * 1000) {

        sessions.delete(code);

        return res.status(410).send(`
            <h1>Code expiré</h1>
            <p>Retourne dans Roblox et génère un nouveau code.</p>
        `);

    }

    const params = new URLSearchParams({

        response_type: "code",

        client_id: CLIENT_ID,

        scope: SCOPES,

        redirect_uri: REDIRECT_URI,

        state: session.state,

        show_dialog: "true"

    });

    res.redirect(
        "https://accounts.spotify.com/authorize?" +
        params.toString()
    );
});

/*
==================================================
CALLBACK SPOTIFY
==================================================
*/

app.get("/callback", async (req, res) => {

    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;

    if (error) {

        return res.send(`
            <!DOCTYPE html>
            <html>
            <body style="
                background:#121212;
                color:white;
                text-align:center;
                font-family:Arial;
                padding-top:100px;
            ">

                <h1 style="color:#e22134;">
                    Connexion annulée
                </h1>

                <p>
                    Tu peux fermer cette fenêtre.
                </p>

            </body>
            </html>
        `);

    }

    if (!code || !state) {

        return res.status(400).send(
            "Paramètres Spotify manquants."
        );

    }

    /*
    ----------------------------------------------
    RETROUVER LA SESSION
    ----------------------------------------------
    */

    let session = null;

    for (const currentSession of sessions.values()) {

        if (currentSession.state === state) {

            session = currentSession;

            break;

        }

    }

    if (!session) {

        return res.status(400).send(
            "Session OAuth invalide ou expirée."
        );

    }

    /*
    ----------------------------------------------
    ÉCHANGER LE CODE CONTRE LES TOKENS
    ----------------------------------------------
    */

    try {

        const credentials = Buffer
            .from(
                `${CLIENT_ID}:${CLIENT_SECRET}`
            )
            .toString("base64");

        const response = await fetch(
            "https://accounts.spotify.com/api/token",
            {

                method: "POST",

                headers: {

                    "Authorization":
                        `Basic ${credentials}`,

                    "Content-Type":
                        "application/x-www-form-urlencoded"

                },

                body: new URLSearchParams({

                    grant_type:
                        "authorization_code",

                    code: code,

                    redirect_uri:
                        REDIRECT_URI

                })

            }
        );

        const data = await response.json();

        if (!response.ok) {

            console.error(
                "Spotify token error:",
                data
            );

            return res.status(500).send(`
                <h1>Erreur Spotify</h1>
                <p>Impossible de connecter le compte.</p>
            `);

        }

        /*
        ------------------------------------------
        ENREGISTRER LES TOKENS
        ------------------------------------------
        */

        session.accessToken =
            data.access_token;

        session.refreshToken =
            data.refresh_token;

        session.expiresAt =
            Date.now() +
            (data.expires_in * 1000);

        session.connected = true;

        /*
        ------------------------------------------
        PAGE DE SUCCÈS
        ------------------------------------------
        */

        res.send(`
            <!DOCTYPE html>

            <html>

            <head>

                <meta charset="UTF-8">

                <title>Spotify connecté</title>

                <style>

                    body {
                        background:#121212;
                        color:white;
                        font-family:Arial;
                        text-align:center;
                        padding-top:100px;
                    }

                    .box {
                        background:#181818;
                        padding:40px;
                        border-radius:20px;
                        display:inline-block;
                    }

                    h1 {
                        color:#1ed760;
                    }

                </style>

            </head>

            <body>

                <div class="box">

                    <h1>
                        ✓ Spotify connecté
                    </h1>

                    <p>
                        Ton compte Spotify est maintenant
                        connecté à Roblox.
                    </p>

                    <p>
                        Tu peux fermer cette page.
                    </p>

                </div>

            </body>

            </html>
        `);

    } catch (error) {

        console.error(error);

        res.status(500).send(
            "Erreur interne du serveur."
        );

    }

});

/*
==================================================
RAFRAÎCHIR LE TOKEN
==================================================
*/

async function getAccessToken(session) {

    if (!session) {
        return null;
    }

    /*
    Le token actuel est encore valide
    */

    if (
        session.accessToken &&
        Date.now() <
            session.expiresAt - 60 * 1000
    ) {

        return session.accessToken;

    }

    /*
    Pas de refresh token
    */

    if (!session.refreshToken) {

        session.connected = false;

        return null;

    }

    try {

        const credentials = Buffer
            .from(
                `${CLIENT_ID}:${CLIENT_SECRET}`
            )
            .toString("base64");

        const response = await fetch(
            "https://accounts.spotify.com/api/token",
            {

                method: "POST",

                headers: {

                    "Authorization":
                        `Basic ${credentials}`,

                    "Content-Type":
                        "application/x-www-form-urlencoded"

                },

                body: new URLSearchParams({

                    grant_type:
                        "refresh_token",

                    refresh_token:
                        session.refreshToken

                })

            }
        );

        const data = await response.json();

        if (!response.ok) {

            console.error(
                "Refresh token error:",
                data
            );

            session.connected = false;

            return null;

        }

        session.accessToken =
            data.access_token;

        session.expiresAt =
            Date.now() +
            (data.expires_in * 1000);

        if (data.refresh_token) {

            session.refreshToken =
                data.refresh_token;

        }

        return session.accessToken;

    } catch (error) {

        console.error(error);

        return null;

    }

}

/*
==================================================
REQUÊTE SPOTIFY
==================================================
*/

async function spotifyRequest(
    session,
    endpoint,
    method = "GET"
) {

    const accessToken =
        await getAccessToken(session);

    if (!accessToken) {
        return null;
    }

    try {

        const response = await fetch(
            `https://api.spotify.com/v1${endpoint}`,
            {

                method: method,

                headers: {

                    "Authorization":
                        `Bearer ${accessToken}`

                }

            }
        );

        /*
        Spotify renvoie 204 quand certaines
        commandes ont réussi.
        */

        if (response.status === 204) {

            return {
                success: true
            };

        }

        const text =
            await response.text();

        if (!text) {

            return {
                success:
                    response.ok
            };

        }

        let data;

        try {

            data =
                JSON.parse(text);

        } catch {

            data = {};

        }

        if (!response.ok) {

            console.error(
                "Spotify API error:",
                response.status,
                data
            );

            return null;

        }

        return data;

    } catch (error) {

        console.error(
            "Spotify request error:",
            error
        );

        return null;

    }

}

/*
==================================================
STATUT DE CONNEXION
==================================================
*/

app.get("/auth/status/:code", (req, res) => {

    const code = req.params.code;

    const session =
        sessions.get(code);

    if (!session) {

        return res.json({
            connected: false,
            exists: false
        });

    }

    res.json({

        connected:
            session.connected === true,

        exists: true

    });

});

/*
==================================================
LECTEUR ACTUEL
==================================================
*/

app.get("/player/:code", async (req, res) => {

    const code = req.params.code;

    const session =
        sessions.get(code);

    if (!session || !session.connected) {

        return res.json({

            connected: false

        });

    }

    const data =
        await spotifyRequest(
            session,
            "/me/player",
            "GET"
        );

    if (!data) {

        return res.json({

            connected: false

        });

    }

    if (!data.item) {

        return res.json({

            connected: true,

            playing: false,

            name: "Aucun morceau",

            artist: "",

            position: 0,

            duration: 0,

            cover: ""

        });

    }

    const item =
        data.item;

    const artist =
        item.artists
            ?.map(a => a.name)
            .join(", ") || "";

    const cover =
        item.album
            ?.images
            ?.at(0)
            ?.url || "";

    res.json({

        connected: true,

        playing:
            data.is_playing === true,

        name:
            item.name || "Inconnu",

        artist:
            artist,

        position:
            data.progress_ms || 0,

        duration:
            item.duration_ms || 0,

        cover:
            cover

    });

});

/*
==================================================
COMMANDES DU LECTEUR
==================================================
*/

app.post(
    "/player/:action/:code",
    async (req, res) => {

        const action =
            req.params.action;

        const code =
            req.params.code;

        const session =
            sessions.get(code);

        if (!session || !session.connected) {

            return res.status(401).json({

                success: false,

                error:
                    "Spotify non connecté"

            });

        }

        const commands = {

            play: {
                endpoint: "/me/player/play",
                method: "PUT"
            },

            pause: {
                endpoint: "/me/player/pause",
                method: "PUT"
            },

            next: {
                endpoint: "/me/player/next",
                method: "POST"
            },

            previous: {
                endpoint: "/me/player/previous",
                method: "POST"
            }

        };

        const command =
            commands[action];

        if (!command) {

            return res.status(400).json({

                success: false,

                error:
                    "Commande inconnue"

            });

        }

        const result =
            await spotifyRequest(
                session,
                command.endpoint,
                command.method
            );

        if (!result) {

            return res.status(500).json({

                success: false,

                error:
                    "Spotify n'a pas répondu"

            });

        }

        res.json({

            success: true

        });

    }
);

/*
==================================================
NETTOYAGE DES SESSIONS
==================================================
*/

setInterval(() => {

    const now = Date.now();

    for (
        const [code, session]
        of sessions
    ) {

        /*
        Sessions non connectées :
        expiration après 10 minutes
        */

        if (
            !session.connected &&
            now - session.createdAt >
                10 * 60 * 1000
        ) {

            sessions.delete(code);

        }

    }

}, 60 * 1000);

/*
==================================================
DÉMARRAGE
==================================================
*/

app.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Roblox Spotify server running on port ${PORT}`
    );

});

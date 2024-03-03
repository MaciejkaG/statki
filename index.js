import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4, validate } from 'uuid';
import session from "express-session";
import { engine } from 'express-handlebars';
import { createClient } from 'redis';
import * as bships from './utils/battleships.js'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');

const server = createServer(app);
const io = new Server(server);
const redis = createClient();
redis.on('error', err => console.log('Redis Client Error', err));
await redis.connect();
redis.flushDb();

const GInfo = new bships.GameInfo(redis, io);

app.set('trust proxy', 1);
const sessionMiddleware = session({
    secret: uuidv4(),
    resave: true,
    saveUninitialized: true,
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.engine.use(sessionMiddleware);

app.get("/", async (req, res) => {
    if (req.session.nickname == null) {
        res.redirect("/setup");
    } else {
        res.render('index');
    }
});

app.get("/setup", (req, res) => {
    if (req.session.nickname != null) {
        res.redirect('/');
    } else {
        res.render("setup");
    }
});

app.post('/api/setup-profile', (req, res) => {
    if (req.session.nickname == null && 4 < req.body.nickname.length && req.body.nickname.length < 16) {
        req.session.nickname = req.body.nickname;
        req.session.playerID = uuidv4();
        req.session.activeGame = null;
    }

    res.redirect("/")
});

app.get("/game", async (req, res) => {
    const game = await redis.json.get(`game:${req.query.id}`);
    if (req.session.nickname == null) {
        res.redirect("/setup");
    } else if (req.query.id == null || game == null || game.state == "expired" || req.session.activeGame == null) {
        res.status(400).send('badGameId');
    } else {
        res.render('board');
    }
});

app.get("/*", (req, res) => {
    res.redirect("/?path=" + req.originalUrl);
});

io.on('connection', async (socket) => {
    const req = socket.request;
    const session = socket.request.session;
    socket.session = session;
    if (session.nickname==null) {
        socket.disconnect();
        return;
    }

    if (!await GInfo.isPlayerInGame(socket)) {
        socket.on('whats my nick', (callback) => {
            callback(session.nickname);
        });

        socket.on('create lobby', (callback) => {
            if (socket.rooms.size === 1) {
                let id = genID();
                callback({
                    status: "ok",
                    gameCode: id
                });

                socket.join(id);
            } else {
                callback({
                    status: "alreadyInLobby",
                    gameCode: socket.rooms[1]
                });
            }
        });

        socket.on('join lobby', (msg, callback) => {
            if (io.sockets.adapter.rooms.get(msg) == null || io.sockets.adapter.rooms.get(msg).size > 1) {
                callback({
                    status: "bad_id"
                });
            } else {
                if (socket.rooms.size === 1) {
                    io.to(msg).emit("joined", session.nickname); // Wyślij hostowi powiadomienie o dołączającym graczu
                    // Zmienna opp zawiera socket hosta
                    let opp = io.sockets.sockets.get(io.sockets.adapter.rooms.get(msg).values().next().value);
                    let oppNickname = opp.request.session.nickname;

                    socket.join(msg); // Dołącz gracza do grupy
                    callback({
                        status: "ok",
                        oppNickname: oppNickname,
                    }); // Wyślij dołączonemu graczowi odpowiedź

                    // Teraz utwórz objekt partii w trakcie w bazie Redis
                    const gameId = uuidv4();
                    redis.json.set(`game:${gameId}`, '$', {
                        hostId: opp.request.session.id,
                        state: "pregame",
                        boards: [
                            { //          typ 2 to trójmasztowiec  pozycja i obrót na planszy  które pola zostały trafione
                                ships: [], // zawiera np. {type: 2, posX: 3, posY: 4, rot: 2, hits: [false, false, true]}
                                //                       pozycja na planszy  czy strzał miał udział w zatopieniu statku?
                                shots: [], // zawiera np. {posX: 3, posY: 5, sunk: true}
                            },
                            {
                                ships: [],
                                shots: [],
                            }
                        ],
                        nextPlayer: 0,
                    });

                    req.session.reload((err) => {
                        if (err) return socket.disconnect();

                        req.session.activeGame = gameId;
                        req.session.save();
                    });

                    const oppReq = opp.request;

                    oppReq.session.reload((err) => {
                        if (err) return socket.disconnect();

                        oppReq.session.activeGame = gameId;
                        oppReq.session.save();
                    });

                    io.to(msg).emit("gameReady", gameId);

                    io.sockets.adapter.rooms.get(msg).forEach((sid) => {
                        const s = io.sockets.sockets.get(sid);
                        s.leave(msg);
                    });
                } else {
                    callback({
                        status: "alreadyInLobby",
                    });
                }
            }
        });

        socket.on('leave lobby', (callback) => {
            if (socket.rooms.size === 2) {
                socket.leave(socket.rooms[1]);
                io.to(socket.rooms[1]).emit("player left");
                callback({
                    status: "ok"
                });
            } else {
                callback({
                    status: "youreNotInLobby"
                });
            }
        });

        socket.on('disconnecting', () => {
            if (bships.isPlayerInRoom(socket)) {
                io.to(socket.rooms[1]).emit("player left");
            }
        });
    } else {
        const playerGame = await GInfo.getPlayerGameData(socket);

        if (playerGame.data.state === 'pregame') {
            socket.join(playerGame.id);
            if (io.sockets.adapter.rooms.get(playerGame.id).size === 2) {
                io.to(playerGame.id).emit('players ready');

                const members = [...roomMemberIterator(playerGame.id)];
                for (let i = 0; i < members.length; i++) {
                    const sid = members[i][0];
                    const socket = io.sockets.sockets.get(sid);
                    if (socket.request.session.id === playerGame.data.hostId) {
                        io.to(sid).emit('player idx', 0);
                    } else {
                        io.to(sid).emit('player idx', 1);
                    }
                }

                let UTCTs = Math.floor((new Date()).getTime() / 1000 + 90);
                io.to(playerGame.id).emit('turn update', { turn: 0, phase: "preparation", timerToUTC: UTCTs });
                bships.timer(90, () => {
                    GInfo.endPrepPhase(socket);
                    bships.timer(30, () => {
                        AFKEnd(playerGame.id);
                    });
                });

                await redis.json.set(`game:${playerGame.id}`, '$.state', "preparation");
            }
        }

        socket.on('place ship', async (type, posX, posY, rot) => {
            const playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame.data.state === 'preparation') {
                const playerShips = await GInfo.getPlayerShips(socket);
                let canPlace = bships.validateShipPosition(playerShips, type, posX, posY, rot);
                let shipAvailable = bships.getShipsAvailable(playerShips)[type] > 0;

                if (!canPlace) {
                    socket.emit("toast", "Nie możesz postawić tak statku");
                } else if (!shipAvailable) {
                    socket.emit("toast", "Nie masz już statków tego typu");
                } else {
                    await GInfo.placeShip(socket, { type: type, posX: posX, posY: posY, rot: rot });
                    socket.emit("placed ship", { type: type, posX: posY, posY: posX, rot: rot });
                }
            }
        });

        socket.on('shoot', async () => {
            const playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame.data.state === 'action') {
                if (bships.checkTurn(playerGame, socket.id)) {
                    
                }
            }
        });

        socket.on('disconnecting', async () => {
            const playerGame = await GInfo.getPlayerGameData(socket);
            if (playerGame !== null) {
                AFKEnd(playerGame.id);
            }
        });
    }
});

server.listen(7777, () => {
    console.log('Server running at http://localhost:7777');
});

function genID() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function resetUserGame(req) {
    req.session.reload((err) => {
        if (err) return socket.disconnect();

        req.session.activeGame = null;
        req.session.save();
    });
}

function endGame(gameId) {
    let iterator = roomMemberIterator(gameId);
    if (iterator != null) {
        const members = [...iterator];
        for (let i = 0; i < members.length; i++) {
            const sid = members[i][0];
            const socket = io.sockets.sockets.get(sid);
            resetUserGame(socket.request);
            socket.leave(gameId);
        }
    }

    redis.json.del(`game:${gameId}`);
}

function AFKEnd(gameId) {
    io.to(gameId).emit("player left");
    endGame(gameId);
}

function roomMemberIterator(id) {
    return io.sockets.adapter.rooms.get(id) == undefined ? null : io.sockets.adapter.rooms.get(id).entries();
}
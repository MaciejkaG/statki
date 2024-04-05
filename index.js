import 'dotenv/config';

const PORT = parseInt(process.env.port);
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import session from "express-session";
import { engine } from 'express-handlebars';
import { createClient } from 'redis';
import * as bships from './utils/battleships.js';
import { MailAuth } from './utils/auth.js';
import { Lang } from './utils/localisation.js';
import { rateLimit } from 'express-rate-limit';
import { RedisStore as LimiterRedisStore } from 'rate-limit-redis';
import SessionRedisStore from 'connect-redis';
import mysql from 'mysql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const flags = process.env.flags ? process.env.flags.split(",") : null;

const langs = [{ id: "en", name: "English" }, { id: "pl", name: "Polish" }];

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

const limiter = rateLimit({
    windowMs: 40 * 1000,
    limit: 500,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new LimiterRedisStore({
        sendCommand: (...args) => redis.sendCommand(args),
    }),
});
app.use(limiter);

const GInfo = new bships.GameInfo(redis, io);
const auth = new MailAuth(redis, {
    host: process.env.mail_host,
    user: process.env.mail_user,
    pass: process.env.mail_pass
},
{
    host: process.env.db_host,
    user: process.env.db_user,
    password: process.env.db_pass,
    database: 'statki'
});

app.set('trust proxy', 1);

let sessionStore = new SessionRedisStore({
    client: redis,
    prefix: "statkiSession:",
});

const sessionMiddleware = session({
    store: sessionStore,
    secret: uuidv4(),
    resave: true,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        secure: checkFlag("cookie_secure"),
        maxAge: 3 * 24 * 60 * 60 * 1000,
    },
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.engine.use(sessionMiddleware);

app.get('/', async (req, res) => {
    let login = loginState(req);

    if (login != 2) {
        res.redirect('/login');
    } else if (req.session.nickname == null) {
        auth.getLanguage(req.session.userId).then(language => {
            var locale;

            req.session.autoLang = language == null ? true : false;

            if (language) {
                locale = new Lang([language]);
                req.session.langs = [language];
            } else {
                locale = new Lang(req.acceptsLanguages());
                req.session.langs = req.acceptsLanguages();
            }

            auth.getNickname(req.session.userId).then(nickname => {
                if (nickname != null) {
                    req.session.nickname = nickname;

                    res.render('index', {
                        helpers: {
                            t: (key) => { return locale.t(key) }
                        }
                    });
                } else {
                    res.redirect('/nickname');
                }
            });
        });
    } else {
        auth.getLanguage(req.session.userId).then(language => {
            var locale;
            if (language) {
                locale = new Lang([language]);
                req.session.langs = [language];
            } else {
                locale = new Lang(req.acceptsLanguages());
                req.session.langs = req.acceptsLanguages();
            }

            res.render('index', {
                helpers: {
                    t: (key) => { return locale.t(key) }
                }
            });
        });
    }
});

app.get('/login', (req, res) => {
    let login = loginState(req);

    const locale = new Lang(req.acceptsLanguages());

    if (!login) {
        res.render('login', {
            helpers: {
                t: (key) => { return locale.t(key) }
            }
        });
    } else if (login == 1) {
        res.redirect('/auth');
    } else {
        res.redirect('/');
    }
});

app.get('/auth', (req, res) => {
    let login = loginState(req);

    const locale = new Lang(req.acceptsLanguages());

    if (!login) { // Niezalogowany
        res.redirect('/login');
    } else if (login == 1) { // W trakcie autoryzacji
        res.render('auth', {
            helpers: {
                t: (key) => { return locale.t(key) }
            }
        });
    } else { // Zalogowany
        res.redirect('/auth');
    }
});

app.get('/nickname', (req, res) => {
    let login = loginState(req);

    const locale = new Lang(req.acceptsLanguages());

    if (!login) { // Niezalogowany
        res.redirect('/login');
    } else {
        res.render('setup', {
            helpers: {
                t: (key) => { return locale.t(key) }
            }
        });
    }
});

app.post('/api/login', (req, res) => {
    let login = loginState(req);

    if (login == 2) {
        res.redirect('/');
    } else if (login == 0 && req.body.email != null && validateEmail(req.body.email)) {
        if (checkFlag('authless')) {
            auth.loginAuthless(req.body.email).then(async result => {
                req.session.userId = result.uid;
                req.session.loggedIn = 2;
                res.redirect('/');
            });

            return;
        }
        auth.startVerification(req.body.email, getIP(req, req.get('User-Agent'))).then(async result => {
            if (result.status === 1 || result.status === -1) {
                req.session.userId = result.uid;

                req.session.loggedIn = 1;
                res.redirect('/auth');
            } else {
                res.sendStatus(500);
            }
        }).catch((err) => {
            const locale = new Lang(req.acceptsLanguages());

            res.render("error", {
                helpers: {
                    error: "Wystąpił nieznany błąd logowania",
                    fallback: "/login",
                    t: (key) => { return locale.t(key) }
                }
            });
            throw err;
        });
    } else {
        const locale = new Lang(req.acceptsLanguages());

        res.render("error", {
            helpers: {
                error: "Niepoprawny adres e-mail",
                fallback: "/login",
                t: (key) => { return locale.t(key) }
            }
        });
    }
});

app.post('/api/auth', async (req, res) => {
    let login = loginState(req);
    if (login == 2) {
        res.redirect('/');
    } else if (login == 1 && req.body.code != null && req.body.code.length <= 10 && req.body.code.length >= 8) {
        let finishResult = await auth.finishVerification(req.session.userId, req.body.code);
        if (finishResult) {
            req.session.loggedIn = 2;
            res.redirect('/');
        } else {
            const locale = new Lang(req.acceptsLanguages());

            res.render("error", {
                helpers: {
                    error: "Niepoprawny kod logowania",
                    fallback: "/auth",
                    t: (key) => { return locale.t(key) }
                }
            });
        }
    } else {
        const locale = new Lang(req.acceptsLanguages());

        res.render("error", {
            helpers: {
                error: "Niepoprawny kod logowania",
                fallback: "/login",
                t: (key) => { return locale.t(key) }
            }
        });
    }
});

app.post('/api/nickname', (req, res) => {
    if (loginState(req) == 2 && req.session.nickname == null && req.body.nickname != null && 3 <= req.body.nickname.length && req.body.nickname.length <= 16) {
        req.session.nickname = req.body.nickname;
        req.session.activeGame = null;
        auth.setNickname(req.session.userId, req.body.nickname).then(() => {
            res.redirect('/');
        });
    } else {
        res.render("error", {
            helpers: {
                error: "Nazwa nie spełnia wymogów: Od 3 do 16 znaków, nie może być pusta",
                fallback: "/nickname",
                t: (key) => { return locale.t(key) }
            }
        });
    }
});

app.get('/game', async (req, res) => {

    const game = await redis.json.get(`game:${req.query.id}`);
    if (req.session.nickname == null) {
        res.redirect('/setup');
    } else if (req.query.id == null || game == null || game.state == 'expired' || req.session.activeGame == null) {
        auth.getLanguage(req.session.userId).then(language => {
            var locale;
            if (language) {
                locale = new Lang([language]);
                req.session.langs = [language];
            } else {
                locale = new Lang(req.acceptsLanguages());
                req.session.langs = req.acceptsLanguages();
            }

            res.render("error", {
                helpers: {
                    error: "Nie znaleziono wskazanej gry",
                    fallback: "/",
                    t: (key) => { return locale.t(key) }
                }
            });
        });
    } else {
        auth.getLanguage(req.session.userId).then(language => {
            var locale;
            if (language) {
                locale = new Lang([language]);
                req.session.langs = [language];
            } else {
                locale = new Lang(req.acceptsLanguages());
                req.session.langs = req.acceptsLanguages();
            }

            res.render('board', {
                helpers: {
                    t: (key) => { return locale.t(key) }
                }
            });
        });
    }
});

app.get("/*", (req, res) => {
    res.redirect("/?path=" + req.originalUrl);
});

io.on('connection', async (socket) => {
    const req = socket.request;
    const session = req.session;
    socket.session = session;
    if (session.nickname==null) {
        socket.disconnect();
        return;
    }

    if (!await GInfo.isPlayerInGame(socket)) {
        socket.on('whats my nick', (callback) => {
            callback(session.nickname);
        });

        socket.on('my profile', (callback) => {
            auth.getProfile(session.userId).then((profile) => {
                profile.uid = session.userId;
                callback(profile);
            });
        });

        socket.on('locale options', (callback) => {
            const locale = new Lang(session.langs);

            let userLanguage = langs.find((element) => element.id == locale.lang);
            let userLangs = langs.filter((element) => element.id != locale.lang);

            if (session.autoLang) {
                userLangs.unshift(userLanguage);
                userLangs.unshift({ id: "null", name: "Auto" });
            } else {
                userLangs.unshift({ id: "null", name: "Auto" });
                userLangs.unshift(userLanguage);
            }

            callback(userLangs);
        });

        socket.on('change locale', (locale, callback) => {
            if (locale === "null" || langs.find((element) => element.id == locale)) {
                locale = locale === "null" ? null : locale;
                const conn = mysql.createConnection({ host: process.env.db_host, user: process.env.db_user, password: process.env.db_pass, database: 'statki' });
                conn.query(`UPDATE accounts SET language = ${conn.escape(locale)} WHERE user_id = ${conn.escape(session.userId)}`, (err) => {
                    if (err) { callback({ status: 'dbErr' }); return; }
                    else callback({ status: 'ok' });

                    req.session.reload((err) => {
                        if (err) return socket.disconnect();

                        req.session.autoLang = locale ? false : true;
                        req.session.save();
                    });
                });
                conn.end();
            }
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
                let opp = io.sockets.sockets.get(io.sockets.adapter.rooms.get(msg).values().next().value);

                if (opp.request.session.userId == session.userId) {
                    callback({
                        status: "cantJoinYourself",
                    });
                    return;
                }
                if (socket.rooms.size === 1) {
                    io.to(msg).emit("joined", session.nickname); // Wyślij hostowi powiadomienie o dołączającym graczu
                    // Zmienna opp zawiera socket hosta
                    // let opp = io.sockets.sockets.get(io.sockets.adapter.rooms.get(msg).values().next().value);
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
                        startTs: (new Date()).getTime() / 1000,
                        boards: [
                            { //          typ 2 to trójmasztowiec  pozycja i obrót na planszy  które pola zostały trafione
                                ships: [], // zawiera np. {type: 2, posX: 3, posY: 4, rot: 2, hits: [false, false, true]}
                                //                       pozycja na planszy  czy strzał miał udział w zatopieniu statku?
                                shots: [], // zawiera np. {posX: 3, posY: 5}
                                stats: {
                                    shots: 0,
                                    hits: 0,
                                    placedShips: 0,
                                    sunkShips: 0,
                                },
                            },
                            {
                                ships: [],
                                shots: [],
                                stats: {
                                    shots: 0,
                                    hits: 0,
                                    placedShips: 0,
                                    sunkShips: 0,
                                },
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
                GInfo.resetTimer(playerGame.id);
                io.to(playerGame.id).emit('players ready');

                const members = [...roomMemberIterator(playerGame.id)];
                for (let i = 0; i < members.length; i++) {
                    const sid = members[i][0];
                    const socket = io.sockets.sockets.get(sid);
                    if (socket.session.id === playerGame.data.hostId) {
                        io.to(sid).emit('player idx', 0);
                    } else {
                        io.to(sid).emit('player idx', 1);
                    }
                }

                let UTCTs = Math.floor((new Date()).getTime() / 1000 + 90);
                io.to(playerGame.id).emit('turn update', { turn: 0, phase: "preparation", timerToUTC: UTCTs });
                GInfo.timer(playerGame.id, 90, async () => {
                    const members = [...roomMemberIterator(playerGame.id)];
                    for (let i = 0; i < members.length; i++) {
                        const sid = members[i][0];
                        const socket = io.sockets.sockets.get(sid);

                        let placedShips = await GInfo.depleteShips(socket);
                        placedShips.forEach(shipData => {
                            socket.emit("placed ship", shipData)
                        });

                        if (placedShips.length > 0) {
                            const locale = new Lang(session.langs);
                            socket.emit("toast", locale.t("board.Your remaining ships have been randomly placed"))
                        }
                    }

                    GInfo.endPrepPhase(socket);
                    GInfo.timer(playerGame.id, 30, () => {
                        AFKEnd(playerGame.id);
                    });
                });

                await redis.json.set(`game:${playerGame.id}`, '$.state', "preparation");
            } else if (io.sockets.adapter.rooms.get(playerGame.id).size > 2) {
                socket.disconnect();
            } else {
                GInfo.timer(playerGame.id, 30, () => {
                    AFKEnd(playerGame.id);
                });
            }
        }

        socket.on('place ship', async (type, posX, posY, rot) => {
            const playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame && playerGame.data.state === 'preparation') {
                const playerShips = await GInfo.getPlayerShips(socket);
                let canPlace = bships.validateShipPosition(playerShips, type, posX, posY, rot);
                let shipAvailable = bships.getShipsAvailable(playerShips)[type] > 0;

                if (!canPlace) {
                    const locale = new Lang(session.langs);

                    socket.emit("toast", locale.t("board.You cannot place a ship like this"));
                } else if (!shipAvailable) {
                    const locale = new Lang(session.langs);

                    socket.emit("toast", locale.t("board.You have ran out of ships of that type"));
                } else {
                    await GInfo.placeShip(socket, { type: type, posX: posX, posY: posY, rot: rot, hits: Array.from(new Array(type+1), () => false) });
                    socket.emit("placed ship", { type: type, posX: posX, posY: posY, rot: rot });
                    await GInfo.incrStat(socket, 'placedShips');
                }
            }
        });

        socket.on('remove ship', async (posX, posY) => {
            const playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame && playerGame.data.state === 'preparation') {
                const deletedShip = await GInfo.removeShip(socket, posX, posY);
                socket.emit("removed ship", { posX: posX, posY: posY, type: deletedShip.type });
                await GInfo.incrStat(socket, 'placedShips', -1);
            }
        });

        socket.on('shoot', async (posX, posY) => {
            let playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame && playerGame.data.state === 'action') {
                if (bships.checkTurn(playerGame.data, socket.session.id)) {
                    const enemyIdx = socket.session.id === playerGame.data.hostId ? 1 : 0;

                    let hit = await GInfo.shootShip(socket, posX, posY);

                    await redis.json.arrAppend(`game:${playerGame.id}`, `.boards[${enemyIdx}].shots`, { posX: posX, posY: posY });
                    await GInfo.incrStat(socket, 'shots');
                    
                    if (!hit.status) {
                        io.to(playerGame.id).emit("shot missed", enemyIdx, posX, posY);
                    } else if (hit.status === 1) {
                        io.to(playerGame.id).emit("shot hit", enemyIdx, posX, posY);
                        await GInfo.incrStat(socket, 'hits');
                    } else if (hit.status === 2) {
                        io.to(playerGame.id).emit("shot hit", enemyIdx, posX, posY);
                        await GInfo.incrStat(socket, 'hits');
                        io.to(playerGame.id).emit("ship sunk", enemyIdx, hit.ship);
                        await GInfo.incrStat(socket, 'sunkShips');

                        if (hit.gameFinished) {
                            const members = [...roomMemberIterator(playerGame.id)];

                            let hostSocket = io.sockets.sockets.get(members[0][0]);
                            let hostNickname = hostSocket.session.nickname;
                            let guestSocket = io.sockets.sockets.get(members[1][0]);
                            let guestNickname = guestSocket.session.nickname;

                            hostSocket.emit("game finished", !enemyIdx ? 1 : 0, guestNickname);
                            guestSocket.emit("game finished", !enemyIdx ? 1 : 0, hostNickname);

                            playerGame = await GInfo.getPlayerGameData(socket);
                            auth.saveMatch(playerGame.id, (new Date).getTime() / 1000 - playerGame.data.startTs, "pvp", hostSocket.session.userId, guestSocket.session.userId, playerGame.data.boards, !enemyIdx ? 1 : 0);

                            GInfo.resetTimer(playerGame.id);
                            endGame(playerGame.id, !enemyIdx ? 1 : 0);
                            return;
                        }
                    } else if (hit.status === -1) {
                        const locale = new Lang(session.langs);

                        socket.emit("toast", locale.t("You have already shot at this field"));
                        return;
                    }

                    await GInfo.passTurn(socket);
                    GInfo.resetTimer(playerGame.id);
                    GInfo.timer(playerGame.id, 30, () => {
                        AFKEnd(playerGame.id);
                    });
                }
            }
        });

        socket.on('disconnecting', async () => {
            const playerGame = await GInfo.getPlayerGameData(socket);
            if (playerGame !== null) {
                AFKEnd(playerGame.id);
                await GInfo.resetTimer(playerGame.id);
            }
        });
    }
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
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
            socket.leave(gameId);
            resetUserGame(socket.request);
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

function loginState(req) {
    if (req.session.loggedIn == null) {
        return 0;
    } else {
        return req.session.loggedIn;
    }
}

function validateEmail(email) {
    return String(email)
        .toLowerCase()
        .match(
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        );
};

function getIP(req) {
    if (checkFlag("cloudflare_mode")) {
        return req.headers['cf-connecting-ip'];
    } else {
        return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    }
}

function checkFlag(key) {
    if (flags) {
        return flags.includes(key);
    } else {
        return false;
    }
}
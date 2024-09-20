import 'dotenv/config';

const PORT = parseInt(process.env.port);
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
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
import { isFakeEmail } from 'fakefilter';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var packageJSON;

fs.readFile(path.join(__dirname, 'package.json'), function (err, data) {
    if (err) throw err;
    packageJSON = JSON.parse(data);
});

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

const prefixes = ["game:*", "timer:*", "loginTimer:*", "codeAuth:*"];

prefixes.forEach(prefix => {
    redis.eval(`for _,k in ipairs(redis.call('keys', '${prefix}')) do redis.call('del', k) end`, 0);
});

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

var sessionSecret = uuidv4();
let secretPath = path.join(__dirname, '.session.secret');

if (fs.existsSync(secretPath)) {
    sessionSecret = fs.readFileSync(secretPath);
} else {
    fs.writeFile(secretPath, sessionSecret, function (err) {
        if (err) {
            console.log("An error occured while saving a freshly generated session secret.\nSessions may not persist after a restart of the server.");
        }
    });
}

const sessionMiddleware = session({
    store: sessionStore,
    secret: sessionSecret,
    resave: true,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        secure: checkFlag("cookie_secure"),
        maxAge: 14 * 24 * 60 * 60 * 1000, // That's 14 days btw
    },
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.engine.use(sessionMiddleware);

app.get('/privacy', (req, res) => {
    res.render("privacy");
});

app.get('/tos', (req, res) => {
    res.redirect('/terms');
});

app.get('/terms', (req, res) => {
    res.render("tos");
});

app.get('/', async (req, res) => {
    const locale = new Lang(req.acceptsLanguages());

    if (req.session.activeGame && await redis.json.get(req.session.activeGame)) {
        res.render("error", {
            helpers: {
                error: "Your account is currently taking part in a game from another session",
                fallback: "/",
                t: (key) => { return locale.t(key) }
            }
        });
        return;
    }

    let login = loginState(req);

    if (login == 0) {
        req.session.userAgent = req.get('user-agent');
        req.session.loggedIn = 0;

        const locale = new Lang(req.acceptsLanguages());

        res.render('landing', {
            helpers: {
                t: (key) => { return locale.t(key) }
            }
        });
    } else if (login != 2) {
        res.redirect("/login");
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
                            t: (key) => { return locale.t(key) },
                            ver: packageJSON.version
                        }
                    });
                } else {
                    res.redirect('/nickname');
                }
            });
        }).catch(err => logger.error({ level: 'error', message: err }));
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
                    t: (key) => { return locale.t(key) },
                    ver: packageJSON.version
                }
            });
        }).catch(err => logger.error({ level: 'error', message: err }));
    }
});

app.get('/match/:searchId', async (req, res) => {
    // req.params.searchId is the matchId user searched through the URL (e.g. /match/9ba20a03-505c-41a1-9933-3bc456e5948f)

    if (req.params.searchId.length !== 36) {
        res.sendStatus(400);
        res.render('error', {
            helpers: {
                error: 'Wrong or missing match ID',
                fallback: '/',
                t: (key) => { return locale.t(key) }
            }
        });
        return;
    }

    let locale;

    if (loginState(req) != 2) {
        locale = new Lang(req.acceptsLanguages());
    } else {
        // Assume this code is within an async function
        locale = new Lang([await auth.getLanguage(req.session.userId)]);
    }

    auth.getMatch(req.params.searchId).then(result => {
        res.render('match', {
            helpers: {
                t: (key) => { return locale.t(key) },
                hostNickname: result.match_info.host_username,
                guestNickname: result.match_info.ai_type ? `AI (${result.match_info.ai_type})` : result.match_info.guest_username,
                hostNicknameClass: result.host_stats.won ? 'dynamic' : 'danger',
                guestNicknameClass: result.host_stats.won ? 'danger' : 'dynamic',

                hostShots: result.host_stats.stats.shots,
                hostHits: result.host_stats.stats.hits,
                hostAccuracy: Math.floor(result.host_stats.stats.hits / result.host_stats.stats.shots * 100),
                hostSunkShips: result.host_stats.stats.sunkShips,

                guestShots: result.guest_stats.stats.shots,
                guestHits: result.guest_stats.stats.hits,
                guestAccuracy: Math.floor(result.guest_stats.stats.hits / result.guest_stats.stats.shots * 100),
                guestSunkShips: result.guest_stats.stats.sunkShips,

                hostBoard: JSON.stringify(result.host_stats),
                guestBoard: JSON.stringify(result.guest_stats),
            }
        });
    }).catch(err => logger.error({ level: 'error', message: err }));
})

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

    if (!login) { // Not logged in, log in before changing your nickname
        res.redirect('/login');
    } else {
        auth.getLanguage(req.session.userId).then(language => {
            let locale;

            if (language) {
                locale = new Lang([language]);
                req.session.langs = [language];
            } else {
                locale = new Lang(req.acceptsLanguages());
                req.session.langs = req.acceptsLanguages();
            }

            res.render('setup', {
                helpers: {
                    t: (key) => { return locale.t(key) }
                }
            });
        }).catch(err => logger.error({ level: 'error', message: err }));
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
            }).catch(err => logger.error({ level: 'error', message: err }));

            return;
        }

        const locale = new Lang(req.acceptsLanguages());

        auth.startVerification(req.body.email, getIP(req), req.get('user-agent'), locale.lang, () => { req.session.destroy(); }).then(async result => {
            if (result.status === 1 || result.status === -1) {
                req.session.userId = result.uid;

                req.session.loggedIn = 1;
                res.redirect('/auth');
            } else {
                res.sendStatus(500);
            }
        }).catch((err) => {
            const locale = new Lang(req.acceptsLanguages());

            res.render('error', {
                helpers: {
                    error: 'Unknown login error occured',
                    fallback: '/login',
                    t: (key) => { return locale.t(key) }
                }
            });

            logger.error({ level: 'error', message: err });
        });
    } else {
        const locale = new Lang(req.acceptsLanguages());

        res.render('error', {
            helpers: {
                error: 'Wrong or forbidden e-mail address',
                fallback: '/login',
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
                    error: "Wrong authorisation code",
                    fallback: "/auth",
                    t: (key) => { return locale.t(key) }
                }
            });
        }
    } else {
        const locale = new Lang(req.acceptsLanguages());

        res.render("error", {
            helpers: {
                error: "Wrong authorisation code",
                fallback: "/login",
                t: (key) => { return locale.t(key) }
            }
        });
    }
});

app.post('/api/nickname', (req, res) => {
    if (loginState(req) == 2 && req.body.nickname != null && 3 <= req.body.nickname.length && escapeHTML(req.body.nickname).length <= 16) {
        req.body.nickname = escapeHTML(req.body.nickname); // Escape HTML from the nickname
        req.session.nickname = req.body.nickname;
        req.session.activeGame = null;
        auth.setNickname(req.session.userId, req.body.nickname).then(() => {
            res.redirect('/');
        }).catch(err => logger.error({ level: 'error', message: err }));
    } else {
        const locale = new Lang(req.acceptsLanguages());

        res.render("error", {
            helpers: {
                error: "The nickname does not meet the requirements: length from 3 to 16 characters",
                fallback: "/nickname",
                t: (key) => { return locale.t(key) }
            }
        });
    }
});

app.get('/game', async (req, res) => {
    const game = await redis.json.get(`game:${req.query.id}`);

    // if (req.session.activeGame) {
    //     res.render("error", {
    //         helpers: {
    //             error: "Your account is currently taking part in a game from another session",
    //             fallback: "/",
    //             t: (key) => { return locale.t(key) }
    //         }
    //     });
    //     return;
    // }

    if (req.session.nickname == null) {
        res.redirect('/setup');
    } else if (!req.query.id || !game || !req.session.activeGame || req.session.activeGame !== req.query.id) {
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
                    error: "The specified game was not found",
                    fallback: "/",
                    t: (key) => { return locale.t(key) }
                }
            });
        }).catch(err => logger.error({ level: 'error', message: err }));
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
        }).catch(err => logger.error({ level: 'error', message: err }));
    }
});

app.get("/*", (req, res) => {
    res.redirect("/?path=" + req.originalUrl);
});

io.on('connection', async (socket) => {
    const req = socket.request;
    const session = req.session;
    socket.session = session;

    const playerGameData = await GInfo.getPlayerGameData(socket);

    if (!session.loggedIn) { // User is on the landing page
        socket.on('email login', (email, callback) => {
            let login = socket.request.session.loggedIn;

            if (login == 0 && email != null && validateEmail(email)) {
                if (checkFlag('authless')) {
                    auth.loginAuthless(email).then(async result => {
                        req.session.reload((err) => {
                            if (err) return socket.disconnect();

                            req.session.userId = result.uid;
                            req.session.loggedIn = 2;
                            req.session.save();
                        });

                        callback({ status: "ok", next: "done" });
                    }).catch(err => logger.error({ level: 'error', message: err }));

                    return;
                }

                const locale = new Lang(session.langs);

                auth.startVerification(email, getIPSocket(socket), socket.client.request.headers["user-agent"], locale.lang, 
                () => {
                    req.session.reload((err) => {
                        if (err) return socket.disconnect(); 
                        req.session.destroy();
                        req.session.save();
                    })
                }).then(async result => {
                    if (result.status === 1 || result.status === -1) {
                        req.session.reload((err) => {
                            if (err) return socket.disconnect();

                            req.session.userId = result.uid;
                            req.session.loggedIn = 1;
                            req.session.save();
                        });

                        callback({ status: "ok", next: "auth" });
                    } else {
                        callback({ status: "SrvErr", error: locale.t("landing.Server error") });
                    }
                }).catch((err) => {
                    const locale = new Lang(session.langs);

                    callback({ success: false, error: locale.t("landing.Unknown error") });
                    logger.error({ level: 'error', message: err });
                });
            } else {
                const locale = new Lang(session.langs);

                auth.loginAuthless(email).then(async result => {
                    req.session.reload((err) => {
                        if (err) return socket.disconnect();

                        req.session.userId = result.uid;
                        req.session.loggedIn = 2;
                        req.session.save();
                    });

                    callback({ success: false, error: locale.t("landing.Wrong email address") });
                }).catch(err => logger.error({ level: 'error', message: err }));
            }
        });

        socket.on('email auth', async (code, callback) => {
            let login = socket.request.session.loggedIn;

            if (login == 1 && code != null && code.length <= 10 && code.length >= 8) {
                let finishResult = await auth.finishVerification(req.session.userId, code);
                if (finishResult) {
                    req.session.reload((err) => {
                        if (err) return socket.disconnect();

                        req.session.loggedIn = 2;
                        req.session.save();
                    });

                    callback({ status: "ok", next: "done" });
                } else {
                    const locale = new Lang(session.langs);

                    callback({ success: false, error: locale.t("landing.Wrong authorisation code") });
                }
            } else {
                const locale = new Lang(session.langs);

                callback({ success: false, error: locale.t("landing.Wrong authorisation code") });
            }
        });

        socket.on('disconnecting', () => {
            if (socket.request.session.loggedIn == 1) {
                req.session.reload((err) => {
                    if (err) return socket.disconnect();

                    req.session.loggedIn = 0;
                    req.session.save();
                });
            }
        });
    } else if (!await GInfo.isPlayerInGame(socket) && session.nickname) { // User is in the main menu
        if (session.nickname == null) {
            socket.disconnect();
            return;
        }

        socket.on('whats my nick', (callback) => {
            callback(session.nickname);
        });

        socket.on('my profile', (callback) => {
            auth.getProfile(session.userId).then(profile => {
                profile.uid = session.userId;
                callback(profile);

                auth.setViewedNews(session.userId);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('get shop', (callback) => {
            auth.getShop().then(shopItems => {
                callback(shopItems);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('buy shop item', (itemId, callback) => {
            auth.buyItem(session.userId, itemId).then(result => {
                callback(result);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('my inventory', (callback) => {
            auth.getInventory(session.userId).then(items => {
                callback(items);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('get drop rates', (callback) => {
            auth.getDropRates().then(items => {
                callback(items);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('set theme', (themeId, callback) => {
            auth.setTheme(session.userId, themeId).then(themeBackground => {
                callback(themeBackground);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('my theme', (callback) => {
            auth.getTheme(session.userId).then(themeBackground => {
                callback(themeBackground);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('set name style', (nameStyleId, callback) => {
            auth.setNameStyle(session.userId, nameStyleId).then(success => {
                callback(success);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('open lootbox', (lootboxId, callback) => {
            auth.openLootbox(session.userId, lootboxId).then(drop => {
                callback(drop);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('use xp boost', (itemId, callback) => {
            auth.useXPBoost(session.userId, itemId).then(result => {
                callback(result);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        // The social stuff
        socket.on('send message', (recipient, content) => {
            auth.sendMessage(session.userId, recipient, content, callback).then(() => {
                callback();
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('match list', (page, callback) => {
            if (typeof page !== 'number' && 1 > page) {
                return;
            }

            auth.getMatchList(session.userId, page).then((matchlist) => {
                if (matchlist.length === 0) {
                    callback(null);
                    return;
                }

                callback(matchlist);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });

        socket.on('match info', (match_id, callback) => {
            auth.getMatch(match_id).then(result => {
                callback(result);
            }).catch(err => logger.error({ level: 'error', message: err }));
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

        socket.on('join lobby', async (msg, callback) => {
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
                    let oppNameStyle = await auth.getNameStyle(opp.session.userId);
                    let userNameStyle = await auth.getNameStyle(session.userId);

                    io.to(msg).emit("joined", session.nickname, userNameStyle); // Notify the host about the joining player
                    // opp variable contains the host's socket
                    // let opp = io.sockets.sockets.get(io.sockets.adapter.rooms.get(msg).values().next().value);
                    let oppNickname = opp.request.session.nickname;

                    socket.join(msg); // Dołącz gracza do grupy

                    callback({
                        status: "ok",
                        oppNickname,
                        oppNameStyle,
                    }); // Wyślij dołączonemu graczowi odpowiedź

                    // Teraz utwórz obiekt partii w trakcie w bazie Redis
                    const gameId = uuidv4();
                    redis.json.set(`game:${gameId}`, '$', {
                        type: 'pvp',
                        hostId: opp.request.session.userId,
                        state: "pregame",
                        startTs: (new Date()).getTime() / 1000,
                        ready: [false, false],
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

                    io.to(msg).emit("game ready", gameId);

                    io.sockets.adapter.rooms.get(msg).forEach((sid) => {
                        const s = io.sockets.sockets.get(sid);
                        s.leave(msg);
                    });

                    GInfo.timer(gameId, 60, () => {
                        AFKEnd(gameId);
                    });
                } else {
                    callback({
                        status: "alreadyInLobby",
                    });
                }
            }
        });

        socket.on('create pve', (difficulty, callback) => {
            if (socket.rooms.size === 1) {
                callback({
                    status: "ok"
                });

                switch (difficulty) {
                    case 'simple':
                        difficulty = 0;
                        break;

                    case 'smart':
                        difficulty = 1;
                        break;

                    case 'overkill':
                        difficulty = 2;
                        break;
                
                    default:
                        difficulty = 1;
                        break;
                }

                // Teraz utwórz obiekt partii w trakcie w bazie Redis
                const gameId = uuidv4();
                redis.json.set(`game:${gameId}`, '$', {
                    type: 'pve',
                    difficulty: difficulty,
                    hostId: session.userId,
                    state: "pregame",
                    startTs: (new Date()).getTime() / 1000,
                    ready: [false, true],
                    boards: [
                        {
                            ships: [],
                            shots: [],
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

                session.reload((err) => {
                    if (err) return socket.disconnect();

                    session.activeGame = gameId;
                    session.save();
                });

                socket.emit("game ready", gameId);

                GInfo.timer(gameId, 60, () => {
                    AFKEnd(gameId);
                });
            } else {
                callback({
                    status: "alreadyInLobby",
                });
            }
        });

        socket.on('logout', () => {
            session.destroy();
        });

        socket.on('disconnecting', () => {
            if (bships.isPlayerInRoom(socket)) {
                io.to(socket.rooms[1]).emit("player left");
            }
        });

        let giftItem = await auth.getGiftNotificationItem(session.userId);

        if (giftItem) {
            const locale = new Lang(session.langs);

            socket.emit('gift received', giftItem, locale.t('menu.General.Thanks for playing Statki!'));
        }
    } else if (session.nickname && playerGameData && ['pvp', 'pve'].includes(playerGameData.data.type)) { // User is either playing in PvP or PvE
        socket.on('my theme', (callback) => {
            auth.getTheme(session.userId).then(themeBackground => {
                callback(themeBackground);
            }).catch(err => logger.error({ level: 'error', message: err }));
        });
        
        socket.on('place ship', async (type, posX, posY, rot) => {
            const playerGame = await GInfo.getPlayerGameData(socket);

            if (type < 0 || type > 3) {
                return;
            }

            if (playerGame && playerGame.data.state === 'preparation') {
                const playerShips = await GInfo.getPlayerShips(socket);
                const canPlace = bships.validateShipPosition(playerShips, type, posX, posY, rot);
                const shipsAvailable = bships.getShipsAvailable(playerShips);
                const shipAvailable = shipsAvailable[type] > 0;

                if (!canPlace) {
                    const locale = new Lang(session.langs);

                    socket.emit("toast", locale.t("board.You cannot place a ship like this"));
                } else if (!shipAvailable) {
                    const locale = new Lang(session.langs);

                    socket.emit("toast", locale.t("board.You have ran out of ships of that type"));
                } else if (shipsAvailable[3] > 0 && type != 3) {
                    const locale = new Lang(session.langs);

                    socket.emit("toast", locale.t("board.You must place a four-masted ship first"));
                } else {
                    await GInfo.placeShip(socket, { type: type, posX: posX, posY: posY, rot: rot, hits: Array.from(new Array(type + 1), () => false) });
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

        socket.on('disconnecting', async () => {
            const playerGame = await GInfo.getPlayerGameData(socket);
            if (playerGame !== null) {
                AFKEnd(playerGame.id);
                await GInfo.resetTimer(playerGame.id);
            }
        });
    }

    if (session.nickname && playerGameData && playerGameData.data.type === "pvp") { // User is playing PvP
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
                    if (socket.request.session.userId === playerGame.data.hostId) {
                        io.to(sid).emit('player idx', 0);
                    } else {
                        io.to(sid).emit('player idx', 1);
                    }
                }

                let UTCTs = Math.floor((new Date()).getTime() / 1000 + 180);
                io.to(playerGame.id).emit('turn update', { turn: 0, phase: "preparation", timerToUTC: UTCTs });
                GInfo.timer(playerGame.id, 180, async () => {
                    finishPrepPhase(socket, playerGame);
                });

                await redis.json.set(`game:${playerGame.id}`, '$.state', "preparation");
            } else if (io.sockets.adapter.rooms.get(playerGame.id).size > 2) {
                socket.disconnect();
            } else {
                GInfo.timer(playerGame.id, 30, () => {
                    AFKEnd(playerGame.id);
                });
            }
        } else {
            socket.disconnect();
        }

        socket.on('ready', async (callback) => {
            if (!(callback && typeof callback === 'function')) {
                return;
            }

            const playerGame = await GInfo.getPlayerGameData(socket);
            let timeLeft = await GInfo.timerLeft(playerGame.id);

            if (timeLeft > 170) {
                const locale = new Lang(session.langs);
                socket.emit('toast', locale.t("board.You cannot ready up so early"));
                return;
            }

            const playerIdx = playerGame.data.hostId === session.userId ? 0 : 1;
            const userNotReady = !playerGame.data.ready[playerIdx];

            if (playerGame && playerGame.data.state === 'preparation' && userNotReady) {
                await GInfo.setReady(socket);
                const playerGame = await GInfo.getPlayerGameData(socket);

                if (playerGame.data.ready[0] && playerGame.data.ready[1]) {
                    // Both set ready
                    await GInfo.resetTimer(playerGame.id);

                    callback();

                    await finishPrepPhase(socket, playerGame);
                } else if (playerGame.data.ready[0] || playerGame.data.ready[1]) {
                    // One player set ready

                    callback();

                    const members = [...roomMemberIterator(playerGame.id)];
                    for (let i = 0; i < members.length; i++) {
                        const sid = members[i][0];
                        const pSocket = io.sockets.sockets.get(sid);
                        if (pSocket.session.id !== socket.session.id) {
                            const locale = new Lang(pSocket.session.langs);

                            pSocket.emit("toast", locale.t("board.Your opponent is ready"))
                        }
                    }

                    let UTCTs = Math.floor((new Date()).getTime() / 1000 + Math.max(timeLeft / 2.5, 15));
                    io.to(playerGame.id).emit('turn update', { turn: 0, phase: "preparation", timerToUTC: UTCTs });
                    await GInfo.timer(playerGame.id, Math.max(timeLeft / 2.5, 15), async () => {
                        await finishPrepPhase(socket, playerGame);
                    });
                }
            }
        });

        socket.on('shoot', async (posX, posY) => {
            let playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame && playerGame.data.state === 'action') {
                if (bships.checkTurn(playerGame.data, session.userId)) {
                    const enemyIdx = session.userId === playerGame.data.hostId ? 1 : 0;

                    let hit = await GInfo.shootShip(socket, enemyIdx, posX, posY);

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

                            let hostSocket;
                            let guestSocket;

                            members.forEach(player => {
                                player = player[0];
                                const playerSocket = io.sockets.sockets.get(player);

                                if (playerSocket.session.userId === playerGame.data.hostId) {
                                    hostSocket = playerSocket;
                                } else {
                                    guestSocket = playerSocket;
                                }
                            });

                            let hostNickname = hostSocket.session.nickname;
                            let guestNickname = guestSocket.session.nickname;

                            let hostNameStyle = await auth.getNameStyle(hostSocket.session.userId);
                            let guestNameStyle = await auth.getNameStyle(guestSocket.session.userId);

                            hostSocket.emit("game finished", !enemyIdx ? 1 : 0, guestNickname, guestNameStyle);
                            guestSocket.emit("game finished", !enemyIdx ? 1 : 0, hostNickname, hostNameStyle);

                            playerGame = await GInfo.getPlayerGameData(socket);
                            auth.saveMatch(playerGame.id, (new Date).getTime() / 1000 - playerGame.data.startTs, "pvp", hostSocket.session.userId, guestSocket.session.userId, playerGame.data.boards, enemyIdx ? 1 : 0);

                            GInfo.resetTimer(playerGame.id);
                            endGame(playerGame.id);
                            return;
                        }
                    } else if (hit.status === -1) {
                        const locale = new Lang(session.langs);

                        socket.emit("toast", locale.t("board.You have already shot at this field"));
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
    } else if (session.nickname && playerGameData && playerGameData.data.type === "pve") { // User is playing PvE
        const playerGame = await GInfo.getPlayerGameData(socket);

        if (playerGame.data.state === 'pregame') {
            socket.join(playerGame.id);
            if (io.sockets.adapter.rooms.get(playerGame.id).size === 1) {
                GInfo.resetTimer(playerGame.id);
                io.to(playerGame.id).emit('players ready');

                socket.emit('player idx', 0);

                let UTCTs = Math.floor((new Date()).getTime() / 1000 + 180);
                io.to(playerGame.id).emit('turn update', { turn: 0, phase: "preparation", timerToUTC: UTCTs });
                GInfo.timer(playerGame.id, 180, async () => {
                    finishPrepPhase(socket, playerGame);
                    placeAIShips(socket);
                });

                await redis.json.set(`game:${playerGame.id}`, '$.state', "preparation");
            } else if (io.sockets.adapter.rooms.get(playerGame.id).size > 2) {
                socket.disconnect();
            }
        } else {
            socket.disconnect();
        }

        socket.on('ready', async (callback) => {
            if (!(callback && typeof callback === 'function')) {
                return;
            }

            const playerGame = await GInfo.getPlayerGameData(socket);

            const playerIdx = 0;
            const userNotReady = !playerGame.data.ready[playerIdx];

            if (playerGame && playerGame.data.state === 'preparation' && userNotReady) {
                await GInfo.setReady(socket);
                const playerGame = await GInfo.getPlayerGameData(socket);

                if (playerGame.data.ready[0] && playerGame.data.ready[1]) {
                    // Both set ready
                    await GInfo.resetTimer(playerGame.id);

                    callback();

                    await finishPrepPhase(socket, playerGame);
                    await placeAIShips(socket);
                }
            }
        });

        socket.on('shoot', async (posX, posY) => {
            let playerGame = await GInfo.getPlayerGameData(socket);

            if (playerGame && playerGame.data.state === 'action') {
                if (bships.checkTurn(playerGame.data, session.userId)) {
                    const enemyIdx = 1;

                    let hit = await GInfo.shootShip(socket, enemyIdx, posX, posY);

                    await redis.json.arrAppend(`game:${playerGame.id}`, `.boards[${enemyIdx}].shots`, { posX: posX, posY: posY });
                    await GInfo.incrStat(socket, 'shots');

                    if (!hit.status) {
                        socket.emit("shot missed", enemyIdx, posX, posY);
                    } else if (hit.status === 1) {
                        socket.emit("shot hit", enemyIdx, posX, posY);
                        await GInfo.incrStat(socket, 'hits');
                    } else if (hit.status === 2) {
                        socket.emit("shot hit", enemyIdx, posX, posY);
                        await GInfo.incrStat(socket, 'hits');
                        io.to(playerGame.id).emit("ship sunk", enemyIdx, hit.ship);
                        await GInfo.incrStat(socket, 'sunkShips');

                        if (hit.gameFinished) {
                            let hostNickname = session.nickname;

                            let difficulty;

                            switch (playerGame.data.difficulty) {
                                case 0:
                                    difficulty = "simple";
                                    break;

                                case 1:
                                    difficulty = "smart";
                                    break;

                                case 2:
                                    difficulty = "overkill";
                                    break;
                            }

                            let guestNickname = `AI (${difficulty})`;

                            socket.emit("game finished", 0, guestNickname);

                            const playerStats = playerGame.data.boards[0].stats;
                            const opponentStats = playerGame.data.boards[1].stats;
                            let xp = calculateXP(playerStats.hits / playerStats.shots * 100, playerStats.sunkShips, opponentStats.sunkShips, playerGame.data.difficulty);

                            playerGame = await GInfo.getPlayerGameData(socket);
                            xp = await auth.addXP(session.userId, xp);
                            auth.saveMatch(playerGame.id, (new Date).getTime() / 1000 - playerGame.data.startTs, "pve", session.userId, '77777777-77777777-77777777-77777777', playerGame.data.boards, 1, difficulty, xp);
                            

                            GInfo.resetTimer(playerGame.id);
                            endGame(playerGame.id);
                            return;
                        }
                    } else if (hit.status === -1) {
                        const locale = new Lang(session.langs);

                        socket.emit("toast", locale.t("board.You have already shot at this field"));
                        return;
                    }

                    await GInfo.passTurn(socket);

                    [posX, posY] = await GInfo.makeAIMove(socket, playerGame.data.difficulty);

                    hit = await GInfo.shootShip(socket, 0, posX, posY);

                    await redis.json.arrAppend(`game:${playerGame.id}`, `.boards[0].shots`, { posX: posX, posY: posY });
                    await GInfo.incrStat(socket, 'shots', 1, 1);

                    if (!hit.status) {
                        socket.emit("shot missed", 0, posX, posY);
                    } else if (hit.status === 1) {
                        socket.emit("shot hit", 0, posX, posY);
                        await GInfo.incrStat(socket, 'hits', 1, 1);
                    } else if (hit.status === 2) {
                        socket.emit("shot hit", 0, posX, posY);
                        await GInfo.incrStat(socket, 'hits', 1, 1);
                        socket.emit("ship sunk", 0, hit.ship);
                        await GInfo.incrStat(socket, 'sunkShips', 1, 1);

                        if (hit.gameFinished) {
                            let difficulty;

                            switch (playerGame.data.difficulty) {
                                case 0:
                                    difficulty = "simple";
                                    break;

                                case 1:
                                    difficulty = "smart";
                                    break;

                                case 2:
                                    difficulty = "overkill";
                                    break;
                            }

                            let guestNickname = `AI (${difficulty})`;

                            socket.emit("game finished", 1, guestNickname);

                            const playerStats = playerGame.data.boards[0].stats;
                            const opponentStats = playerGame.data.boards[1].stats;
                            let xp = calculateXP(playerStats.hits / playerStats.shots * 100, playerStats.sunkShips, opponentStats.sunkShips, playerGame.data.difficulty);

                            playerGame = await GInfo.getPlayerGameData(socket);
                            xp = await auth.addXP(session.userId, xp);
                            auth.saveMatch(playerGame.id, (new Date).getTime() / 1000 - playerGame.data.startTs, "pve", session.userId, '77777777-77777777-77777777-77777777', playerGame.data.boards, 0, difficulty, xp);

                            GInfo.resetTimer(playerGame.id);
                            endGame(playerGame.id);
                            return;
                        }
                    }

                    await GInfo.passTurn(socket);

                    GInfo.resetTimer(playerGame.id);
                    GInfo.timer(playerGame.id, 30, () => {
                        AFKEnd(playerGame.id);
                    });
                }
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

    redis.unlink(`game:${gameId}`);
}

function AFKEnd(gameId) {
    io.to(gameId).emit("player left");
    endGame(gameId);
}

async function finishPrepPhase(socket, playerGame) {
    await GInfo.endPrepPhase(socket);

    const members = [...roomMemberIterator(playerGame.id)];
    for (let i = 0; i < members.length; i++) {
        const sid = members[i][0];
        const socket = io.sockets.sockets.get(sid);

        let placedShips = await GInfo.depleteShips(socket);
        if (!placedShips) {
            io.to(playerGame.id).emit('toast', "An error occured while autoplacing player's ships");
            endGame(playerGame.id);
            return;
        }

        placedShips.forEach(shipData => {
            socket.emit("placed ship", shipData)
        });

        if (placedShips.length > 0) {
            const locale = new Lang(socket.session.langs);
            socket.emit("toast", locale.t("board.Your remaining ships have been randomly placed"))
        }
    }

    GInfo.timer(playerGame.id, 30, () => {
        AFKEnd(playerGame.id);
    });

    return true;
}

async function placeAIShips(socket) {
    await GInfo.depleteShips(socket, 1);
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
        ) && !isFakeEmail(email);
};

function getIP(req) {
    if (checkFlag("cloudflare_mode")) {
        return req.headers['cf-connecting-ip'];
    } else {
        return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    }
}

function getIPSocket(socket) {
    if (checkFlag("cloudflare_mode")) {
        return socket.client.request.headers['cf-connecting-ip'];
    } else {
        return socket.client.request.headers['x-forwarded-for'] || socket.handshake.address;
    }
}

function checkFlag(key) {
    if (flags) {
        return flags.includes(key);
    } else {
        return false;
    }
}

function calculateXP(accuracy, shipsSunk, shipsLost, difficulty) {
    let difficultyMultiplier;

    switch (difficulty) {
        case 0:
            difficultyMultiplier = 1;
            break;
        case 1:
            difficultyMultiplier = 3;
            break;
        case 2:
            difficultyMultiplier = 5;
            break;
        default:
            difficultyMultiplier = 1; // Default to 1 if an invalid difficulty is passed
    }

    // Calculate base XP
    let baseXP = (shipsSunk) / (shipsLost / 2) * 20;

    // Calculate accuracy bonus
    let accuracyBonus = accuracy * 3; // Adjusted to fit the average target

    // Total XP before applying the difficulty multiplier
    let totalXP = (baseXP + accuracyBonus);

    // Apply difficulty multiplier
    totalXP *= difficultyMultiplier;

    // Round down to the nearest integer
    totalXP = Math.floor(totalXP);

    return totalXP;
}

function escapeHTML(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
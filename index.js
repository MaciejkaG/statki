import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import session from "express-session";
import { engine } from 'express-handlebars';

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

app.set('trust proxy', 1);
const sessionMiddleware = session({
    secret: uuidv4(),
    resave: true,
    saveUninitialized: true,
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.engine.use(sessionMiddleware);

app.get("/", (req, res) => {
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

app.post('/api/setup-profile', function (req, res) {
    if (req.session.nickname == null && 4 < req.body.nickname.length && req.body.nickname.length < 16) {
        req.session.nickname = req.body.nickname;
    }

    res.redirect("/")
});

app.get("/*", (req, res) => {
    res.redirect("/?path=" + req.originalUrl);
});

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (session.nickname==null) {
        socket.disconnect();
        return;
    }

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
        if (io.sockets.adapter.rooms.get(msg) == null) {
            callback({
                status: "bad_id"
            });
        } else {
            if (socket.rooms.size === 1) {
                io.to(msg).emit("joined", session.nickname);
                let opp = io.sockets.sockets.get(io.sockets.adapter.rooms.get(msg).values().next().value);
                let oppNickname = opp.request.session.nickname;
                socket.join(msg);
                callback({
                    status: "ok",
                    oppNickname: oppNickname,
                });
            } else {
                callback({
                    status: "alreadyInLobby",
                    gameCode: id,
                });
            }
        }
    });

    socket.on('leave lobby', (callback) => {
        if (socket.rooms.size === 2) {
            socket.leave(socket.rooms[1]);
            callback({
                status: "ok"
            });
        } else {
            callback({
                status: "youreNotInLobby"
            });
        }
    });
});

server.listen(7777, () => {
    console.log('Server running at http://localhost:7777');
});

function genID() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
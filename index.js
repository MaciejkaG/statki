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
    
    res.render('index');
});

app.get("/*", (req, res) => {
    res.redirect("/?path=" + req.originalUrl);
});

io.on('connection', (socket) => {
    const session = socket.request.session;

    

    socket.on('chat message', (msg) => {
        console.log('message: ' + msg);
    });
});

server.listen(7777, () => {
    console.log('Server running at http://localhost:7777');
});
// export class Client {
//     constructor(clientId, clientSecret, redirectUri) {
//         this.clientId = clientId;
//         this.clientSecret = clientSecret;
//         this.redirectUri = redirectUri;
//     }
//     getAccessToken(code) {
//     }
// }

export class GameInfo {
    constructor(redis, io) {
        this.redis = redis;
        this.io = io;
    }

    async isPlayerInGame(socket) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        return game != null;
    }

    async getPlayerGameData(socket) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        return game == null ? null : { id: socket.session.activeGame, data: game };
    }

    async endPrepPhase(socket) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;

        await this.redis.json.set(key, '$.state', 'action');
        await this.redis.json.set(key, '$.nextPlayer', 0);

        const UTCTs = Math.floor((new Date()).getTime() / 1000 + 30);
        this.io.to(gameId).emit('turn update', { turn: 0, phase: "action", timerToUTC: UTCTs });
    }

    async passTurn(socket) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;

        await this.redis.json.set(key, '$.state', 'action');
        let nextPlayer = await this.redis.json.get(key, '$.nextPlayer');
        nextPlayer = nextPlayer === 0 ? 1 : 0;
        await this.redis.json.set(key, '$.nextPlayer', nextPlayer);

        const UTCTs = Math.floor((new Date()).getTime() / 1000 + 30);
        this.io.to(gameId).emit('turn update', { turn: 0, phase: "action", timerToUTC: UTCTs });
    }
}

export function isPlayerInRoom(socket) {
    return !socket.rooms.size === 1;
}

var lastTimeChange = new Date().getTime();

export function timer(time, callback) {
    let localLastChange = lastTimeChange;

    let timeout = setTimeout(callback, time * 1000);

    let interval = setInterval(() => {
        if (timeout._destroyed) {
            // timer is finished, stop monitoring turn changes
            clearInterval(interval);
        }
        if (localLastChange != lastTimeChange) {
            // timer has been reset
            clearTimeout(timeout);
            clearInterval(interval);
        }
    }, 200);
}

export function resetTimers() {
    lastTimeChange = -lastTimeChange;
}

// export function getShipsLeft(data, playerIdx) {
//     let shipsLeft = [4, 3, 2, 1];

//     const playerShips = shipsLeft.boards[playerIdx].ships;

//     playerShips.forEach(ship => {
//         var isSunk = true;
//         ship.hits.every(isHit => {
//             isSunk = isHit;
//             return isHit;
//         });
//         switch (ship.type) {
//             case 0:
//                 shipsLeft[0]--;
//                 break;
        
//             default:
//                 break;
//         }
//     });
// }

export function getShipsAvailable(data, playerIdx) {
    let shipsLeft = [4, 3, 2, 1];

    const playerShips = shipsLeft.boards[playerIdx].ships;

    playerShips.forEach(ship => {
        shipsLeft[ship.type]--;
    });

    return shipsLeft;
}

export function checkShot(data, playerIdx) {
    playerIdx = playerIdx === 0 ? 1 : 0

    data.boards[playerIdx]
}

export function checkTurn(data, playerId) {
    // Check if it's player's turn
    if (playerId == data.hostId) {
        return data.nextPlayer === 0;
    } else {
        return data.nextPlayer === 1;
    }
}

// timer(5, () => {
//     console.log("out of time");
// });
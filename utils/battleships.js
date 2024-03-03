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

    async getPlayerShips(socket) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        const idx = socket.request.session.id === game.hostId ? 0 : 1;
        return game.boards[idx].ships;
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

        await this.redis.json.set(key, '.state', 'action');
        let nextPlayer = await this.redis.json.get(key, '.nextPlayer');
        nextPlayer = nextPlayer === 0 ? 1 : 0;
        await this.redis.json.set(key, '.nextPlayer', nextPlayer);

        const UTCTs = Math.floor((new Date()).getTime() / 1000 + 30);
        this.io.to(gameId).emit('turn update', { turn: 0, phase: "action", timerToUTC: UTCTs });
    }

    async placeShip(socket, shipData) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, {path: '$.hostId'}))[0];

        const playerIdx = socket.request.session.id === hostId ? 0 : 1;
        let res = await this.redis.json.arrAppend(key, `.boards[${playerIdx}].ships`, shipData);
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

export function getShipsAvailable(ships) {
    let shipsLeft = [4, 3, 2, 1];

    ships.forEach(ship => {
        shipsLeft[ship.type]--;
    });

    return shipsLeft;
}

export function checkHit(data, playerIdx, posX, posY) {
    playerIdx = playerIdx === 0 ? 1 : 0;

    let enemyBoard = data.boards[playerIdx];

    let boardRender = [];

    for (let i = 0; i < 10; i++) {
        var array = [];
        for (let i = 0; i < 10; i++) {
            array.push(false);
        }
        boardRender.push(array);
    }

    enemyBoard.ships.forEach(ship => {
        let multips;

        switch (ship.rot) {
            case 0:
                multips = [1, 0];
                break;

            case 1:
                multips = [0, 1];
                break;

            case 2:
                multips = [-1, 0];
                break;

            case 3:
                multips = [0, -1];
                break;
        }

        for (let i = 0; i < ship.type + 2; i++) {
            boardRender[ship.posY + multips[1] * i][ship.posX + multips[0] * i] = true;
        }
    });

    return boardRender[posY][posX];
}

export function validateShipPosition(ships, type, posX, posY, rot) {
    let boardRender = [];

    for (let i = 0; i < 10; i++) {
        var array = [];
        for (let i = 0; i < 10; i++) {
            array.push(false);
        }
        boardRender.push(array);
    }

    ships.forEach(ship => {

        let multips;

        switch (ship.rot) {
            case 0:
                multips = [0, 1];
                break;

            case 1:
                multips = [1, 0];
                break;

            case 2:
                multips = [0, -1];
                break;

            case 3:
                multips = [-1, 0];
                break;
        }

        for (let i = 0; i < ship.type + 1; i++) {
            boardRender[ship.posY + multips[1] * i][ship.posX + multips[0] * i] = true;
        }
    });

    let multips;

    switch (rot) {
        case 0:
            multips = [0, 1];
            break;

        case 1:
            multips = [1, 0];
            break;

        case 2:
            multips = [0, -1];
            break;

        case 3:
            multips = [-1, 0];
            break;
    }

    for (let x = 0; x <= type; x++) {
        if (posY + multips[1] * x > 9 || posY + multips[1] * x < 0 || posX + multips[0] * x > 9 || posX + multips[0] * x < 0) {
            return false;
        }

        let subtrahents = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]; // Usuń cztery ostatnie elementy jeżeli chcesz by statki mogły się stykać rogami
        for (let y = 0; y < subtrahents.length; y++) {
            const idxY = posY - subtrahents[y][0] + multips[1] * x;
            const idxX = posX - subtrahents[y][1] + multips[0] * x;
            if (!(idxY < 0 || idxY > 9 || idxX < 0 || idxX > 9) && boardRender[idxY][idxX]) {
                return false;
            }
        }
    }

    return true;
}

export function checkTurn(data, playerId) {
    // Check if it's player's turn
    if (playerId == data.hostId) {
        return data.nextPlayer === 0;
    } else {
        return data.nextPlayer === 1;
    }
}

// let type = 3;
// let posX = 3;
// let posY = 0;
// let rot = 2;

// let data = {
//     hostId: "123456",
//     state: "action",
//     boards: [
//         {
//             ships: [
//                 { type: type, posX: posX, posY: posY, rot: rot, hits: [false, false, false] },
//             ],
//             shots: [],
//         },
//         {
//             ships: [],
//             shots: [],
//         }
//     ],
//     nextPlayer: 0,
// }

// checkHit(data, 1, 0, 0);

// console.log(validateShipPosition(type, posX, posY, rot));
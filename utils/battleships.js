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
        let nextPlayer = await this.redis.json.get(key, { path:'.nextPlayer' });
        nextPlayer = nextPlayer === 0 ? 1 : 0;
        await this.redis.json.set(key, '.nextPlayer', nextPlayer);

        const UTCTs = Math.floor((new Date()).getTime() / 1000 + 30);
        this.io.to(gameId).emit('turn update', { turn: nextPlayer, phase: "action", timerToUTC: UTCTs });
    }

    async placeShip(socket, shipData) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, {path: '.hostId'}));

        const playerIdx = socket.request.session.id === hostId ? 0 : 1;
        await this.redis.json.arrAppend(key, `.boards[${playerIdx}].ships`, shipData);
    }

    async removeShip(socket, posX, posY) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, { path: '.hostId' }));

        const playerIdx = socket.request.session.id === hostId ? 0 : 1;
        let playerShips = await this.redis.json.get(key, {path: `.boards[${playerIdx}].ships`});

        var deletedShip;
        playerShips = playerShips.filter(function (ship) {
            if (ship.posX == posX && ship.posY == posY) {
                deletedShip = ship;
            }

            return ship.posX != posX || ship.posY != posY
        });

        await this.redis.json.set(key, `.boards[${playerIdx}].ships`, playerShips);
        return deletedShip;
    }

    async shootShip(socket, posX, posY) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, { path: '.hostId' }));

        const enemyIdx = socket.request.session.id === hostId ? 1 : 0;
        const playerIdx = enemyIdx ? 0 : 1;

        let playerShips = await this.redis.json.get(key, { path: `.boards[${enemyIdx}].ships` });

        var check = checkHit(playerShips, posX, posY);

        if (!check) {
            return false;
        }

        var shotShip;
        for (let i = 0; i < playerShips.length; i++) {
            const ship = playerShips[i];

            if (ship.posX === check.originPosX & ship.posY === check.originPosY) {
                shotShip = ship;
                playerShips[i].hits[check.fieldIdx] = true;
            }
        }

        await this.redis.json.set(key, `.boards[${enemyIdx}].ships`, playerShips);

        return true;
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

export function checkHit(ships, posX, posY) {
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
            console.log(`boardRender[${ship.posX + multips[1] * i}][${ship.posY + multips[0] * i}]`)
            boardRender[ship.posX + multips[1] * i][ship.posY + multips[0] * i] = {fieldIdx: i, originPosX: ship.posX, originPosY: ship.posY};
        }
    });

    return boardRender[posX][posY];
}

export function validateShipPosition(ships, type, posX, posY, rot) {
    if (type < 0 || type > 3 || rot < 0 || rot > 3) {
        return false;
    }

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

        for (let i = 0; i < ship.type + 1; i++) {
            boardRender[ship.posX + multips[0] * i][ship.posY + multips[1] * i] = true;
        }
    });

    let multips;

    switch (rot) {
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

    for (let x = 0; x <= type; x++) {
        if (posX + multips[0] * x > 9 || posX + multips[0] * x < 0 || posY + multips[1] * x > 9 || posY + multips[1] * x < 0) {
            return false;
        }

        let subtrahents = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]; // Usuń cztery ostatnie elementy jeżeli chcesz by statki mogły się stykać rogami
        for (let y = 0; y < subtrahents.length; y++) {
            const idxX = posX - subtrahents[y][0] + multips[0] * x;
            const idxY = posY - subtrahents[y][1] + multips[1] * x;
            if (!(idxX < 0 || idxX > 9 || idxY < 0 || idxY > 9) && boardRender[idxX][idxY]) {
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
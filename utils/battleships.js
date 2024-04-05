export class GameInfo {
    constructor(redis, io) {
        this.redis = redis;
        this.io = io;
    }

    async timer(tId, time, callback) {
        await this.redis.set(`timer:${tId}`, new Date().getTime() / 1000);
        let localLastUpdate = await this.redis.get(`timer:${tId}`);

        let timeout = setTimeout(callback, time * 1000);

        let interval = setInterval(async () => {
            if (timeout._destroyed) {
                // timer is finished, stop monitoring turn changes
                clearInterval(interval);
                return;
            }

            let lastUpdate = await this.redis.get(`timer:${tId}`);
            if (localLastUpdate != lastUpdate) {
                // timer has been reset
                clearTimeout(timeout);
                clearInterval(interval);
                return;
            }
        }, 200);
    }

    async resetTimer(tId) {
        let lastUpdate = await this.redis.get(`timer:${tId}`);
        await this.redis.set(`timer:${tId}`, -lastUpdate);
    }

    async isPlayerInGame(socket) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        return game != null;
    }

    async getPlayerGameData(socket) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        return game == null ? null : { id: socket.session.activeGame, data: game };
    }

    async getStats(socket) {
        const boards = await this.redis.json.get(`game:${socket.session.activeGame}`, { path: ".boards" });
        let stats = [];

        boards.forEach(board => {
            stats.push(board.stats);            
        });

        return stats;
    }

    async incrStat(socket, statKey, by = 1) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        const idx = socket.request.session.id === game.hostId ? 0 : 1;

        this.redis.json.numIncrBy(`game:${socket.session.activeGame}`, `.boards[${idx}].stats.${statKey}`, by);
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
        nextPlayer = !nextPlayer ? 1 : 0;
        await this.redis.json.set(key, '.nextPlayer', nextPlayer);

        const UTCTs = Math.floor((new Date()).getTime() / 1000 + 30);
        this.io.to(gameId).emit('turn update', { turn: nextPlayer, phase: "action", timerToUTC: UTCTs });
    }

    async placeShip(socket, shipData) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, { path: '.hostId' }));

        const playerIdx = socket.request.session.id === hostId ? 0 : 1;
        await this.redis.json.arrAppend(key, `.boards[${playerIdx}].ships`, shipData);
    }

    async depleteShips(socket) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, { path: '.hostId' }));

        const playerIdx = socket.request.session.id === hostId ? 0 : 1;

        var playerShips = (await this.redis.json.get(key, { path: `.boards[${playerIdx}].ships` }));

        const availableShips = getShipsAvailable(playerShips);

        const boardRender = [];
        const subtrahents = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];

        for (let i = 0; i < 10; i++) {
            var array = [];
            for (let i = 0; i < 10; i++) {
                array.push(false);
            }
            boardRender.push(array);
        }

        playerShips.forEach(ship => {
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

            for (let i = 0; i <= ship.type; i++) {
                for (let l = 0; l < subtrahents.length; l++) {
                    const idxX = ship.posX - subtrahents[l][0] + multips[0] * i;
                    const idxY = ship.posY - subtrahents[l][1] + multips[1] * i;
                    if (!(idxX < 0 || idxX > 9 || idxY < 0 || idxY > 9)) {
                        boardRender[idxX][idxY] = true;
                    }
                }
            }
        });

        const placedShips = [];

        for (let i = 0; i < availableShips.length; i++) {
            let availableShipsOfType = availableShips[i];
            for (let j = 0; j < availableShipsOfType; j++) {
                playerShips = (await this.redis.json.get(key, { path: `.boards[${playerIdx}].ships` }));
                for (let y = 0; y < 10; y++) {
                    let row = "";
                    for (let x = 0; x < 10; x++) {
                        row += `${boardRender[x][y] ? "\x1b[31m" : "\x1b[32m"}${boardRender[x][y]}\x1b[0m\t`;
                    }
                }
                const search = findEmptyFields(boardRender, i+1);

                const rPos = search[Math.floor(Math.random() * search.length)];

                placedShips.push({ type: i, posX: rPos.posX, posY: rPos.posY, rot: rPos.rot });
                await this.redis.json.arrAppend(key, `.boards[${playerIdx}].ships`, { type: i, posX: rPos.posX, posY: rPos.posY, rot: rPos.rot, hits: Array.from(new Array(i + 1), () => false) });
                let multips;

                switch (rPos.rot) {
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

                for (let k = 0; k <= i; k++) {
                    for (let l = 0; l < subtrahents.length; l++) {
                        const idxX = rPos.posX - subtrahents[l][0] + multips[0] * k;
                        const idxY = rPos.posY - subtrahents[l][1] + multips[1] * k;
                        if (!(idxX < 0 || idxX > 9 || idxY < 0 || idxY > 9)) {
                            boardRender[idxX][idxY] = true;
                        }
                    }
                }
            }
        }

        return placedShips;
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
        // const playerIdx = enemyIdx ? 0 : 1;

        let playerBoard = await this.redis.json.get(key, { path: `.boards[${enemyIdx}]` });

        let shot = playerBoard.shots.find((shot) => shot.posX === posX && shot.posY === posY);
        if (shot) {
            return { status: -1 }
        }

        var check = checkHit(playerBoard.ships, posX, posY);

        if (!check) {
            return { status: 0 };
        }

        var shotShip;
        for (let i = 0; i < playerBoard.ships.length; i++) {
            const ship = playerBoard.ships[i];

            if (ship.posX === check.originPosX & ship.posY === check.originPosY) {
                shotShip = ship;
                playerBoard.ships[i].hits[check.fieldIdx] = true;
                if (!playerBoard.ships[i].hits.includes(false)) {
                    let gameFinished = true;
                    await this.redis.json.set(key, `.boards[${enemyIdx}]`, playerBoard);
                    playerBoard.ships.every(ship => {
                        if (ship.hits.includes(false)) {
                            gameFinished = false;
                            return false;
                        } else {
                            return true;
                        }
                    });

                    return { status: 2, ship: ship, gameFinished: gameFinished };
                }
            }
        }

        await this.redis.json.set(key, `.boards[${enemyIdx}]`, playerBoard);
        return { status: 1, ship: shotShip };
    }
}

export function isPlayerInRoom(socket) {
    return !socket.rooms.size === 1;
}

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

        for (let i = 0; i <= ship.type; i++) {
            let x = clamp(ship.posX + multips[0] * i, 0, 9);
            let y = clamp(ship.posY + multips[1] * i, 0, 9);

            boardRender[x][y] = {fieldIdx: i, originPosX: ship.posX, originPosY: ship.posY};
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

        for (let i = 0; i <= ship.type; i++) {
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

function findEmptyFields(grid, len) {
    const rowPlacements = [];

    // Helper function to check if a row can be placed horizontally at a given position
    function canPlaceHorizontally(x, y) {
        if (x + len >= grid[0].length) {
            return false; // Ship exceeds board boundaries
        }
        for (let i = x; i <= x + len; i++) {
            if (grid[i][y]) {
                return false; // One of ship's fields is already occupied
            }
        }
        return true;
    }

    // Helper function to check if a row can be placed vertically at a given position
    function canPlaceVertically(x, y) {
        if (y + len >= grid.length) {
            return false; // Ship exceeds board boundaries
        }
        for (let i = y; i <= y + len; i++) {
            if (grid[x][i]) {
                return false; // One of ship's fields is already occupied
            }
        }
        return true;
    }

    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[0].length; j++) {
            if (grid[j][i] === false) {
                if (canPlaceHorizontally(j, i)) {
                    rowPlacements.push({ posX: j, posY: i, rot: 0 });
                }

                if (canPlaceVertically(j, i)) {
                    rowPlacements.push({ posX: j, posY: i, rot: 1 });
                }
            }
        }
    }

    return rowPlacements;
}

function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
}
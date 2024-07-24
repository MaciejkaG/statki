export class GameInfo {
    constructor(redis, io) {
        this.redis = redis;
        this.io = io;
    }

    async timer(tId, time, callback) {
        await this.redis.json.set(`timer:${tId}`, '$', { lastUpdate: new Date().getTime() / 1000, end: new Date().getTime() / 1000 + time });
        let localLastUpdate = await this.redis.json.get(`timer:${tId}`, { path: ".lastUpdate" });

        let timeout = setTimeout(callback, time * 1000);

        let interval = setInterval(async () => {
            if (timeout._destroyed) {
                // timer is finished, stop monitoring turn changes
                clearInterval(interval);
                return;
            }

            let lastUpdate = await this.redis.json.get(`timer:${tId}`, { path: ".lastUpdate" });
            if (localLastUpdate != lastUpdate) {
                // timer has been reset
                clearTimeout(timeout);
                clearInterval(interval);
                return;
            }
        }, 200);
    }

    async timerLeft(tId) {
        let end = await this.redis.json.get(`timer:${tId}`, { path: ".end" });
        let left = end - new Date().getTime() / 1000;
        return left;
    }

    async resetTimer(tId) {
        let lastUpdate = await this.redis.json.get(`timer:${tId}`, { path: ".end" });
        await this.redis.json.set(`timer:${tId}`, '.lastUpdate', -lastUpdate);
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

    async incrStat(socket, statKey, by = 1, idx) {
        if (!idx) {
            const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
            idx = socket.request.session.userId === game.hostId ? 0 : 1;
        }

        this.redis.json.numIncrBy(`game:${socket.session.activeGame}`, `.boards[${idx}].stats.${statKey}`, by);
    }

    async getPlayerShips(socket) {
        const game = await this.redis.json.get(`game:${socket.session.activeGame}`);
        const idx = socket.request.session.userId === game.hostId ? 0 : 1;
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

        const playerIdx = socket.request.session.userId === hostId ? 0 : 1;
        await this.redis.json.arrAppend(key, `.boards[${playerIdx}].ships`, shipData);
    }

    async depleteShips(socket, playerIdx) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, { path: '.hostId' }));

        if (!playerIdx) {
            playerIdx = socket.request.session.userId === hostId ? 0 : 1;
        }

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

        // Iterate the types of ships left in reverse order to ensure the four-masted is always placed first to prevent one specific layout where it's impossible to place the four-masted ship.
        for (let i = availableShips.length; i > -1; i--) {
            let availableShipsOfType = availableShips[i];
            for (let j = 0; j < availableShipsOfType; j++) {
                playerShips = (await this.redis.json.get(key, { path: `.boards[${playerIdx}].ships` }));

                let print = "";
                for (let y = 0; y < 10; y++) {
                    let row = "";
                    for (let x = 0; x < 10; x++) {
                        row += `${boardRender[x][y] ? "\x1b[31m" : "\x1b[32m"}${boardRender[x][y]}\x1b[0m\t`;
                    }
                    print += row+"\n";
                }

                const search = findEmptyFields(boardRender, i + 1);

                const rPos = search[Math.floor(Math.random() * search.length)];

                if (rPos == null) {
                    return false;
                }

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

        const playerIdx = socket.request.session.userId === hostId ? 0 : 1;
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

    async shootShip(socket, enemyIdx, posX, posY) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;

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

    async makeAIMove(socket, difficulty) {
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;

        const boards = await this.redis.json.get(key, { path: `.boards` });

        if (difficulty == 1) { // If difficulty mode is set to smart, check if there are any shot but not sunk ships
            // Iterate through player's ships
            for (let i = 0; i < boards[0].ships.length; i++) {
                const ship = boards[0].ships[i];
                // If the ship has at least one hit field and at least one not hit field
                if (ship.hits.includes(false) && ship.hits.includes(true)) {
                    // Iterate through ships
                    for (let fieldIdx = 0; fieldIdx < ship.hits.length; fieldIdx++) {
                        // If the ship we're currently iterating has been hit...
                        if (ship.hits[fieldIdx]) {
                            let multips;

                            switch (ship.rot) { // Set up proper multipliers for each possible rotation
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

                            // hitFieldX and hitFieldY simply contain the exact coordinates of the hit field of the ship on the board
                            let hitFieldX = clamp(ship.posX + multips[0] * fieldIdx, 0, 9);
                            let hitFieldY = clamp(ship.posY + multips[1] * fieldIdx, 0, 9);

                            // subtrahents array contains sets of difference factors from the hit field.
                            // We will use them to target fields around the field that was already hit
                            // They are similar to the ones used in validateShipPosition(), but shorter
                            // This is because we do not want to target fields that touch corners with our hit field, but the ones that touch with sides
                            let subtrahents = [[0, 1], [1, 0], [0, -1], [-1, 0]];

                            // Shuffle them, so they are later iterated in random order
                            shuffle(subtrahents);

                            // Iterate through all subtrahents
                            for (let j = 0; j < subtrahents.length; j++) {
                                const subs = subtrahents[j];

                                // Calculate the target field based on the current set of subtrahents, then clamp it so it doesn't exceed board's boundaries
                                let targetX = clamp(hitFieldX - subs[0], 0, 9);
                                let targetY = clamp(hitFieldY - subs[1], 0, 9);

                                // If the bot has hit two fields of the ship already, lock axises depending on the rotation of the ship
                                // This makes it so if the bot has hit two out of four fields of a ship that's placed horizontally, it won't shoot above the ship as the ships are always a straight line
                                if (ship.hits.filter(value => value === true).length >= 2) {
                                    if (!ship.rot % 2) {
                                        targetY = hitFieldY;
                                    } else {    
                                        targetX = hitFieldX;
                                    }
                                }

                                let shot = boards[0].shots.find((shot) => shot.posX === targetX && shot.posY === targetY);
                                // If shot == null then the field with coordinates posX and posY was not shot at yet

                                if (!shot) {
                                    // If the field has not been shot yet and it seems possible, try it!
                                    return [targetX, targetY];
                                }
                            }
                        }
                    }
                }
            }
        }

        if (difficulty != 2) { // If difficulty mode is not set to Overkill
            var foundAppropriateTarget = false;

            var [posX, posY] = [Math.floor(Math.random() * 10), Math.floor(Math.random() * 10)]; // Randomise first set of coordinates

            while (!foundAppropriateTarget) { // As long as no appropriate target was found
                [posX, posY] = [Math.floor(Math.random() * 10), Math.floor(Math.random() * 10)]; // Randomise another set of coordinates

                let shot = boards[0].shots.find((shot) => shot.posX === posX && shot.posY === posY);
                // If shot == null then the field with coordinates posX and posY was not shot at yet

                if (!shot) {
                    if (difficulty == 1) { // If difficulty mode is set to smart, check if the shot wasn't near any sunk ship (not done yet)
                        var sunkShips = [];

                        // Iterate through player's ships
                        for (let i = 0; i < boards[0].ships.length; i++) {
                            const ship = boards[0].ships[i];

                            // If ship is sunk (all fields are hit)
                            if (!ship.hits.includes(false)) {
                                // Add the ship to the sunkShips array
                                sunkShips.push(ship);
                            }
                        }

                        // We will use the validateShipPosition() function
                        // it was originally designed for verifying if a ship is going to be placed correctly, but it will fit the purpose perfectly
                        // We are checking if a single masted ship with 0 rotation could be placed in the position of the picked shot
                        // We are also going to use the sunkShips array instead of all ships, because we WANT to shoot around unsunk but DON'T WANT to shoot around sunk ships
                        foundAppropriateTarget = validateShipPosition(sunkShips, 0, posX, posY, 0);
                    } else { // If difficulty mode is set to simple, just accept that field
                        foundAppropriateTarget = true;
                    }
                }
            }

            return [posX, posY];
        } else { // If the difficulty mode is set to Overkill
            // Find all unsunk ships
            const unsunkShips = boards[0].ships.filter(ship => ship.hits.includes(false));

            // Pick a random unsunk ship
            if (unsunkShips.length > 0) {
                const randomShip = unsunkShips[Math.floor(Math.random() * unsunkShips.length)];

                // Calculate ship positions based on rotation
                const positions = [];
                for (let i = 0; i < randomShip.hits.length; i++) {
                    let targetX = randomShip.posX;
                    let targetY = randomShip.posY;

                    switch (randomShip.rot) {
                        case 0: // left to right
                            targetX += i;
                            break;
                        case 1: // top to bottom
                            targetY += i;
                            break;
                        case 2: // right to left
                            targetX -= i;
                            break;
                        case 3: // bottom to top
                            targetY -= i;
                            break;
                    }

                    positions.push([targetX, targetY]);
                }

                // Find the first unhit part of the ship
                for (let i = 0; i < randomShip.hits.length; i++) {
                    if (!randomShip.hits[i]) {
                        // Return the coordinates of the first unhit part of the ship
                        return positions[i];
                    }
                }
            }
        }
    }

    async setReady(socket) { // This makes the socket go ready in a match
        const gameId = socket.session.activeGame;
        const key = `game:${gameId}`;
        const hostId = (await this.redis.json.get(key, { path: '.hostId' }));

        const playerIdx = socket.request.session.userId === hostId ? 0 : 1;

        await this.redis.json.set(key, `.ready[${playerIdx}]`, true);
    }
}

export function isPlayerInRoom(socket) { // Returns true if the socket is in any socket.io room, otherwise false
    return !socket.rooms.size === 1;
}

export function getShipsAvailable(ships) { // Returns the amount ships left for each type from list of already placed ships (can be obtained from player's board object)
    let shipsLeft = [4, 3, 2, 1];

    ships.forEach(ship => {
        shipsLeft[ship.type]--;
    });

    return shipsLeft;
}

export function checkHit(ships, posX, posY) { // Checks if a shot at posX and posY is hit (ships is the opponent's ship list)
    let boardRender = []; // Create a two-dimensional array that will contain a render of the entire enemy board

    // Fill the array with false values
    for (let i = 0; i < 10; i++) {
        var array = [];
        for (let i = 0; i < 10; i++) {
            array.push(false);
        }
        boardRender.push(array);
    }
    // The array is now 10x10 filled with false values

    ships.forEach(ship => {
        let multips;

        switch (ship.rot) { // Set up proper multipliers for each possible rotation
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

        // If multips[0] == 1 then each ship's field will go further by one field from left to right
        // If multips[0] == -1 then each ship's field will go further by one field from right to left
        // If multips[1] == 1 then each ship's field will go further by one field from top to bottom
        // If multips[1] == -1 then each ship's field will go further by one field from bottom to top

        // Iterate through all ship's fields
        for (let i = 0; i <= ship.type; i++) {
            // Calculate the X and Y coordinates of the current field, clamp them in case they overflow the array
            let x = clamp(ship.posX + multips[0] * i, 0, 9);
            let y = clamp(ship.posY + multips[1] * i, 0, 9);

            boardRender[x][y] = {fieldIdx: i, originPosX: ship.posX, originPosY: ship.posY}; // Set the field in the board render
        }
    });

    // The function returns false if no ship has been hit and an array including following keys if it does:
    // fieldIdx, originPosX, originPosY
    // where fieldIdx is the amount of fields from the originating point of the ship (in the direction appropriate to set rotation)
    // and originPosX and originPosY are the coordinates of the originating point of the ship
    // the originating point of the ship is essentialy the field on which a user clicked to place a ship
    return boardRender[posX][posY];
}

export function validateShipPosition(ships, type, posX, posY, rot) { // This function checks whether a certain position of a new ship is valid. It returns true if it is and false otherwise
    if (type == null || posX == null || posY == null || rot == null || type < 0 || type > 3 || rot < 0 || rot > 3 || posX < 0 || posY < 0 || posX > 9 || posY > 9) {
        return false; // Return false when any of the values is incorrect
    }

    let boardRender = []; // Create a two-dimensional array that will contain a render of the entire enemy board

    // Fill the array with false values
    for (let i = 0; i < 10; i++) {
        var array = [];
        for (let i = 0; i < 10; i++) {
            array.push(false);
        }
        boardRender.push(array);
    }
    // The array is now 10x10 filled with false values

    // Iterate through all ships that are already placed, for rendering them on the boardRender array
    ships.forEach(ship => {
        let multips;

        switch (ship.rot) { // Set up multipliers for each possible rotation, this basically defines the direction of the fields, depending on the rotation
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

        // If multips[0] == 1 then each ship's field will go further by one field from left to right
        // If multips[0] == -1 then each ship's field will go further by one field from right to left
        // If multips[1] == 1 then each ship's field will go further by one field from top to bottom
        // If multips[1] == -1 then each ship's field will go further by one field from bottom to top

        // Iterate through all ship's fields
        for (let i = 0; i <= ship.type; i++) {
            // Set the boardRender value under the field's coordinates to true
            boardRender[ship.posX + multips[0] * i][ship.posY + multips[1] * i] = true;
        }
    });

    // Set up multipliers again, this time for the ship to place
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

    // Iterate through each ship's field
    for (let x = 0; x <= type; x++) {
        if (posX + multips[0] * x > 9 || posX + multips[0] * x < 0 || posY + multips[1] * x > 9 || posY + multips[1] * x < 0) {
            return false; // Return false if the ship's field exceeds the boards bounderies
        }

        // Set up subtrahents that we will use to calculate fields around the ship and check if they do not contain another ship to prevent ships from being placed next to each other
        let subtrahents = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];

        // Iterate through each subtrahents set
        for (let y = 0; y < subtrahents.length; y++) {

            // Calculate the field's indexes
            const idxX = posX - subtrahents[y][0] + multips[0] * x;
            const idxY = posY - subtrahents[y][1] + multips[1] * x;

            // If the field's index does not exceed the boards boundaries, check whether it's set as true in the boardRender
            if (!(idxX < 0 || idxX > 9 || idxY < 0 || idxY > 9) && boardRender[idxX][idxY]) {
                return false; // Return false if the ship is next to another
            }
        }
    }

    // If all the checks pass, return true
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

function findEmptyFields(grid, len) { // Find all empty fields in the board
    const shipPlacements = [];

    // Helper function to check if a row can be placed horizontally at a given position
    function canPlaceHorizontally(x, y) {
        // Check if the ship exceeds the board boundaries horizontally
        if (x + len > grid.length) {
            return false;
        }
        // Check if any field within the ship's length is already occupied
        for (let i = x; i < x + len; i++) {
            if (grid[i][y]) {
                return false;
            }
        }
        return true;
    }

    // Helper function to check if a row can be placed vertically at a given position
    function canPlaceVertically(x, y) {
        // Check if the ship exceeds the board boundaries vertically
        if (y + len > grid[0].length) {
            return false;
        }
        // Check if any field within the ship's length is already occupied
        for (let i = y; i < y + len; i++) {
            if (grid[x][i]) {
                return false;
            }
        }
        return true;
    }

    // Loop through the grid to find empty places
    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[0].length; j++) {
            if (!grid[i][j]) { // Check if the current position is empty
                if (canPlaceHorizontally(i, j)) {
                    shipPlacements.push({ posX: i, posY: j, rot: 0 });
                }

                if (canPlaceVertically(i, j)) {
                    shipPlacements.push({ posX: i, posY: j, rot: 1 });
                }
            }
        }
    }

    return shipPlacements;
}

// Basic array shuffling function
function shuffle(array) {
    let currentIndex = array.length;

    while (currentIndex != 0) {
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }
}

function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
}
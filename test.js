function findEmptyFields(grid, len) {
    const rowPlacements = [];

    // Helper function to check if a row can be placed horizontally at a given position
    function canPlaceHorizontally(x, y) {
        console.log(x, y);
        // console.log(x + len)
        // console.log(x + len >= grid.length)
        if (x + len >= grid[0].length) {
            return false; // Ship exceeds board boundaries
        }
        for (let i = x; i < x + len; i++) {
            if (grid[i][y]) {
                return false; // One of ship's fields is already occupied
            }
        }
        return true;
    }

    // Helper function to check if a row can be placed vertically at a given position
    function canPlaceVertically(x, y) {
        // console.log(y + len)
        // console.log(y + len >= grid.length)
        if (y + len >= grid.length) {
            return false; // Ship exceeds board boundaries
        }
        for (let i = y; i < y + len; i++) {
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

let data = {
    hostId: "123456",
    state: "action",
    boards: [
        {
            ships: [
                { type: 3, posX: 3, posY: 4, rot: 0, hits: [false, false, false] },
            ],
            shots: [],
        },
        {
            ships: [],
            shots: [],
        }
    ],
    nextPlayer: 0,
}

// checkHit(data, 1, 0, 0);

// console.log(validateShipPosition(type, posX, posY, rot));

let boardRender = [];

for (let i = 0; i < 10; i++) {
    var array = [];
    for (let i = 0; i < 10; i++) {
        array.push(false);
    }
    boardRender.push(array);
}

data.boards[0].ships.forEach(ship => {
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

// const rot = 0;
const type = 3;

// let multips;

// switch (rot) {
//     case 0:
//         multips = [1, 0];
//         break;

//     case 1:
//         multips = [0, 1];
//         break;

//     case 2:
//         multips = [-1, 0];
//         break;

//     case 3:
//         multips = [0, -1];
//         break;
// }

boardRender = [
    [
        true, true, true,
        true, true, true,
        true, false, true,
        true
    ],
    [
        true, true, true,
        true, true, true,
        true, false, true,
        true
    ],
    [
        false, true, true,
        true, true, true,
        true, true, true,
        true
    ],
    [
        false, true, true,
        true, false, false,
        true, true, true,
        false
    ],
    [
        false, false, false,
        true, true, true,
        true, true, true,
        false
    ],
    [
        false, false, false,
        true, true, true,
        true, true, false,
        false
    ],
    [
        true, true, true,
        true, true, true,
        true, true, true,
        true
    ],
    [
        true, true, true,
        true, false, false,
        false, true, true,
        true
    ],
    [
        true, true, true,
        true, true, true,
        true, true, true,
        true
    ],
    [
        false, false, false,
        true, true, true,
        true, false, false,
        false
    ]
];

let search = findEmptyFields(boardRender, 4);
for (let y = 0; y < 10; y++) {
    let row = "";
    for (let x = 0; x < 10; x++) {
        row += `${boardRender[x][y] ? "\x1b[31m" : "\x1b[32m"}${boardRender[x][y]}\x1b[0m\t`;
    }
    console.log(row);
}
console.log(search);

const rPos = search[Math.floor(Math.random() * search.length)];

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

for (let i = 0; i <= type; i++) {
    console.log(`boardRender[${rPos.posX + multips[0] * i}][${rPos.posY + multips[1] * i}]`)
    boardRender[rPos.posX + multips[0] * i][rPos.posY + multips[1] * i] = true;
}

for (let y = 0; y < 10; y++) {
    let row = "";
    for (let x = 0; x < 10; x++) {
        row += `${boardRender[x][y] ? "\x1b[31m" : "\x1b[32m"}${boardRender[x][y]}\x1b[0m\t`;
    }
    console.log(row);
}

// console.log(); 
// console.log(findAllRowsOfXTrueValues(matrix, 3, 1)); 
// console.log(findAllRowsOfXTrueValues(matrix, 3, 2)); 
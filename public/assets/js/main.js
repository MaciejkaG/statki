const mapSize = 10;

const bsc = new Battleships(mapSize);

let board = bsc.generateDOMBoard(mapSize);
$("#board").html(board);
$("#secondaryBoard").html(board);

var previousRow = $(":not(*)");
var previousColumn = $(":not(*)");
var selectedShip = 0;
var shipRotation = 0;
var changedFields = [];

var hoveredField = null;

$("#board .field").hover(function () {
    hoveredField = this;
    // Pokaż "miarki"
    let posY = parseInt($(this).data("pos-x"));
    let posX = parseInt($(this).data("pos-y"));
    let row = bsc.getRow(posY);
    let column = bsc.getColumn(posX);

    changedFields.push(row, column, $(this));

    row.css("background", "rgb(136, 136, 136)");
    column.css("background", "rgb(136, 136, 136)");

    $(this).css("background", "rgb(68, 68, 68)");

    previousRow = row;
    previousColumn = column;

    // Pokaż podgląd statku
    posX++;
    posY++;
    var fields = [];
    switch (shipRotation) {
        case 0:
            for (let i = 0; i < 4; i++) {
                fields.push([posX + i, posY]);
            }
            break;
        case 1:
            for (let i = 0; i < 4; i++) {
                fields.push([posX, posY + i]);
            }
            break;
        case 2:
            for (let i = 0; i < 4; i++) {
                fields.push([posX - i, posY]);
            }
            break;
        case 3:
            for (let i = 0; i < 4; i++) {
                fields.push([posX, posY - i]);
            }
            break;
    }

    var fieldElem;
    let failed = false;
    for (let i = 0; i < selectedShip+1; i++) {
        const field = fields[i];

        try {
            fieldElem = bsc.getField(field[0], field[1]);
        } catch {
            if (!failed) {
                failed = true;
                i = -1;
            }
        }
        
        if (failed) {
            fieldElem.css("background", "rgb(255, 163, 163)");
        } else {
            fieldElem.css("background", "rgb(163, 255, 163)");
        }
        changedFields.push(fieldElem);
    }
}, function () {
    hoveredField = null;
    // Wyłącz "miarki" po wyjściu kursora z pola (aby się nie duplikowały w przyszłości)
    changedFields.forEach(field => {
        field.css("background", "rgb(201, 201, 201)");
    });
    changedFields.length = 0;
});

$("#board .field").on("click", function() {

});

var ownBoardIsActive = true;

function switchBoards() {
    if (ownBoardIsActive) { // Aktywna jest plansza użytkownika
        $("#secondaryBoard").removeClass("secondary");
        $("#board").addClass("secondary");
        $(".ownBoardInfo").css("opacity", 0);
        $(".controlsOwnBoard").css("opacity", 0.3);
    } else { // Aktywna jest plansza przeciwnika
        $("#board").removeClass("secondary");
        $("#secondaryBoard").addClass("secondary");
        $(".ownBoardInfo").css("opacity", 1);
        $(".controlsOwnBoard").css("opacity", 1);
    }

    ownBoardIsActive = !ownBoardIsActive;
}

function switchShips() {
    if (selectedShip===3) {
        selectedShip = 0;
    } else {
        selectedShip++;
    }

    refreshBoardView();

    $("#selectedShip").addClass("changing");
    
    setTimeout(() => {
        switch (selectedShip) {
            case 0:
                $("#selectedShip").html("Jednomasztowiec");
                break;
            case 1:
                $("#selectedShip").html("Dwumasztowiec");
                break;
            case 2:
                $("#selectedShip").html("Trójmasztowiec");
                break;
            case 3:
                $("#selectedShip").html("Czteromasztowiec");
                break;
        }

        $("#selectedShip").removeClass("changing");
    }, 200);
}

function switchRotation() {
    if (shipRotation === 3) {
        shipRotation = 0;
    } else {
        shipRotation++;
    }

    refreshBoardView();
}

function refreshBoardView() {
    if (hoveredField) {
        changedFields.forEach(field => {
            field.css("background", "rgb(201, 201, 201)");
        });
        changedFields.length = 0;

        let posY = parseInt($(hoveredField).data("pos-x"));
        let posX = parseInt($(hoveredField).data("pos-y"));
        let row = bsc.getRow(posY);
        let column = bsc.getColumn(posX);

        changedFields.push(row, column, $(hoveredField));

        row.css("background", "rgb(136, 136, 136)");
        column.css("background", "rgb(136, 136, 136)");

        $(hoveredField).css("background", "rgb(68, 68, 68)");

        previousRow = row;
        previousColumn = column;

        posX++;
        posY++;
        var fields = [];
        switch (shipRotation) {
            case 0:
                for (let i = 0; i < 4; i++) {
                    fields.push([posX + i, posY]);
                }
                break;
            case 1:
                for (let i = 0; i < 4; i++) {
                    fields.push([posX, posY + i]);
                }
                break;
            case 2:
                for (let i = 0; i < 4; i++) {
                    fields.push([posX - i, posY]);
                }
                break;
            case 3:
                for (let i = 0; i < 4; i++) {
                    fields.push([posX, posY - i]);
                }
                break;
        }

        var fieldElem;
        let failed = false;
        for (let i = 0; i < selectedShip + 1; i++) {
            const field = fields[i];

            try {
                fieldElem = bsc.getField(field[0], field[1]);
            } catch {
                if (!failed) {
                    failed = true;
                    i = -1;
                }
            }

            if (failed) {
                fieldElem.css("background", "rgb(255, 163, 163)");
            } else {
                fieldElem.css("background", "rgb(163, 255, 163)");
            }
            changedFields.push(fieldElem);
        }
    }
}
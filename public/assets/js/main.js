const mapSize = 10;

const bsc = new Battleships(mapSize);

let board = bsc.generateDOMBoard(mapSize);
$("#board").html(board);
$("#secondaryBoard").html(board);

var previousRow = $(":not(*)");
var previousColumn = $(":not(*)");
var selectedShip = 0;
var shipRotation = 0;
var shipsLeft = [4, 3, 2, 1];
var changedFields = [];

var postPrep = false;
var myTurn = false;

var hoveredField = null;

refreshBoardView();

$(".board .field").hover(function () {
    if ($(window).width() <= 820) {
        changedFields.forEach(field => {
            field.css("background-color", "var(--field)");
        });
        changedFields.length = 0;
    }

    hoveredField = this;
    // Pokaż "miarki"
    let posX = parseInt($(this).data("pos-x"));
    let posY = parseInt($(this).data("pos-y"));
    let row = bsc.getRow(posY);
    let column = bsc.getColumn(posX);

    changedFields.push(row, column, $(this));

    row.css("background-color", "var(--mark-line)");
    column.css("background-color", "var(--mark-line)");

    previousRow = row;
    previousColumn = column;

    if (postPrep) {
        if (myTurn) {
            $(this).css("background-color", "var(--mark-ship-invalid)");
        } else {
            $(this).css("background-color", "var(--mark-spot)");
        }
    } else {
        $(this).css("background-color", "var(--mark-spot)");

        // Pokaż podgląd statku

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
        for (let i = 0; i <= selectedShip; i++) {
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
                fieldElem.css("background-color", "var(--mark-ship-invalid)");
            } else {
                fieldElem.css("background-color", "var(--mark-ship-valid)");
            }
            changedFields.push(fieldElem);
        }
    }
}, function () {
    if ($(window).width() > 820) {
        hoveredField = null;
        // Wyłącz "miarki" po wyjściu kursora z pola (aby się nie duplikowały w przyszłości)
        changedFields.forEach(field => {
            field.css("background-color", "var(--field)");
        });
        changedFields.length = 0;
    }
});

// $(".board .field").on("click", function() {

// });

var ownBoardIsActive = true;

$("#board").removeClass("secondary");
$("#secondaryBoard").addClass("secondary");
$(".ownBoardInfo").css("opacity", 1);
$(".controlsOwnBoard").css("opacity", 1);

function switchBoards() {
    if (postPrep) {
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
    let shipsOfType = shipsLeft[selectedShip];
    $("#shipsLeft").html(shipsOfType);
    if (!shipsOfType) {
        $("#shipsLeft").addClass("danger");
    } else {
        $("#shipsLeft").removeClass("danger");
    }

    if (hoveredField) {
        changedFields.forEach(field => {
            field.css("background-color", "var(--field)");
        });
        changedFields.length = 0;

        let posX = parseInt($(hoveredField).data("pos-x"));
        let posY = parseInt($(hoveredField).data("pos-y"));
        let row = bsc.getRow(posY);
        let column = bsc.getColumn(posX);

        changedFields.push(row, column, $(hoveredField));

        row.css("background-color", "var(--mark-line)");
        column.css("background-color", "var(--mark-line)");

        $(hoveredField).css("background-color", "var(--mark-field)");

        previousRow = row;
        previousColumn = column;

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
        for (let i = 0; i <= selectedShip; i++) {
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
                fieldElem.css("background-color", "var(--mark-ship-invalid)");
            } else {
                fieldElem.css("background-color", "var(--mark-ship-valid)");
            }
            changedFields.push(fieldElem);
        }
    }
}
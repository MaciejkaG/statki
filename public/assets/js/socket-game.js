const socket = io();

var playerIdx;
var timerDestination = null;
var gamePhase = 'pregame';
var occupiedFields = [];

var lastTimeClick = 0;

$('#board .field').on('click', function () {
    console.log(new Date().getTime() / 1000 - lastTimeClick);
    if (new Date().getTime() / 1000 - lastTimeClick > 0.3) {
        socket.emit("place ship", selectedShip, $(this).data('pos-x'), $(this).data('pos-y'), shipRotation);
        lastTimeClick = new Date().getTime() / 1000;
    }
});

$('#secondaryBoard .field').on('click', function () {
    if (new Date().getTime() / 1000 - lastTimeClick > 0.3) {
        socket.emit("shoot", $(this).data('pos-x'), $(this).data('pos-y'));
        lastTimeClick = new Date().getTime() / 1000;
    }
});

$('.field').on('contextmenu', function () {
    if ($(this).hasClass('active') && new Date().getTime() / 1000 - lastTimeClick > 0.3) {
        let originPos = occupiedFields.find((elem) => elem.pos[0] == $(this).data('pos-x') && elem.pos[1] == $(this).data('pos-y')).origin;

        socket.emit("remove ship", originPos[0], originPos[1]);
        lastTimeClick = new Date().getTime() / 1000;
    }
});

socket.on('toast', (msg) => {
    Toastify({
        text: msg,
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});

socket.on("placed ship", (data) => {
    let shipFields = bsc.placeShip(data);
    lastTimeClick = new Date().getTime() / 1000;
    shipFields.forEach(field => {
        occupiedFields.push({pos: field, origin: [data.posX, data.posY]});
    });
    shipsLeft[data.type]--;
    refreshBoardView();
});

socket.on("removed ship", (data) => {
    const shipFields = occupiedFields.filter(elem => { 
        return elem.origin[0] == data.posX && elem.origin[1] == data.posY;
    });

    for (let i = 0; i < shipFields.length; i++) {
        const field = shipFields[i];
        setTimeout(() => {
            bsc.getField(field.pos[0], field.pos[1]).removeClass("active");
        }, i * 150);
    }

    occupiedFields = occupiedFields.filter(n => !shipFields.includes(n));

    shipsLeft[data.type]++;
    refreshBoardView();
});

socket.on("shot hit", (victimIdx, posX, posY) => {
    if (victimIdx === playerIdx) {
        bsc.setField(posX, posY, "hit");
    } else {
        bsc.setFieldEnemy(posX, posY, "hit");
    }
});

socket.on("shot missed", (victimIdx, posX, posY) => {
    if (victimIdx === playerIdx) {
        bsc.setField(posX, posY, "miss");
    } else {
        bsc.setFieldEnemy(posX, posY, "miss");
    }
});

socket.on("ship sunk", (victimIdx, ship) => {
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

    let l = ship.type + 1;
    if (victimIdx === playerIdx) {
        for (let i = 0; i < l; i++) {
            console.log("ourship");
            setTimeout(() => {
                bsc.setField(ship.posX + multips[0] * i, ship.posY + multips[1] * i, "sunken");
            }, i * 150);
        }
    } else {
        for (let i = 0; i < l; i++) {
            console.log("theirship");
            setTimeout(() => {
                bsc.setFieldEnemy(ship.posX + multips[0] * i, ship.posY + multips[1] * i, "sunken");
            }, i * 150);
        }
    }
});

// Update timer
var updateTimer = setInterval(() => {
    if (timerDestination == null) {
        $("#timer").html("");
    } else {
        const UTCNow = Math.floor((new Date()).getTime() / 1000);

        const time = Math.abs(UTCNow - timerDestination);

        if (time < 10) {
            $("#timer").addClass("active");
        } else {
            $("#timer").removeClass("active");
        }

        const minutes = Math.floor(time / 60).toLocaleString('pl-PL', { minimumIntegerDigits: 2, useGrouping: false });
        const seconds = (time - minutes * 60).toLocaleString('pl-PL', { minimumIntegerDigits: 2, useGrouping: false });

        $("#timer").html(`${minutes}:${seconds}`);
    }
}, 250);

socket.on("game finished", (winnerIdx, oppName) => {
    socket.disconnect();
    $("#opponent").html(`Vs. <span class="important">${oppName}</span>`);

    if (winnerIdx === playerIdx) {
        $("#state").html("Zwycięstwo");
        $("#state").addClass("dynamic");
    } else {
        $("#state").html("Porażka");
        $("#state").addClass("danger");
    }

    $(".cover").addClass("postGame");
    clearInterval(updateTimer);
    $("#timer").html(`00:00`);
    $(".cover").css({ opacity: 1, pointerEvents: "all" });
});

socket.on('connect', () => {
    $(".cover .title").html("Oczekiwanie na serwer...");
});

socket.on("players ready", () => {
    $(".cover").css({ opacity: 0, pointerEvents: "none" });
});

socket.on("player idx", (idx) => {
    playerIdx = idx;
});

socket.on('turn update', (turnData) => {
    if (turnData.phase === "preparation") {
        $("#whosTurn").html("Faza przygotowań");
        $("#boardSwitch").css("opacity", 0.3);
    } else {
        postPrep = true;
        myTurn = turnData.turn === playerIdx;
        turnData.turn === playerIdx ? $("#whosTurn").html("Twoja tura") : $("#whosTurn").html("Tura przeciwnika");
        $("#boardSwitch").css("opacity", 1);
    }

    timerDestination = turnData.timerToUTC;
    gamePhase = turnData.phase;
    refreshBoardView();
});

socket.on('player left', () => {
    window.location.replace("/");
});
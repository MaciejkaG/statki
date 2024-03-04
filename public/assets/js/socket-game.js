const socket = io();

var playerIdx;
var timerDestination = null;
var gamePhase = 'pregame';
var occupiedFields = [];

$('.field').on('click', function () {
    socket.emit("place ship", selectedShip, $(this).data('pos-x'), $(this).data('pos-y'), shipRotation);
});

$('.field').on('contextmenu', function () {
    if ($(this).children('.shipField').hasClass('active')) {
        let originPos = occupiedFields.find((elem) => elem.pos[0] == $(this).data('pos-x') && elem.pos[1] == $(this).data('pos-y')).origin;

        socket.emit("remove ship", originPos[0], originPos[1]);
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

    shipFields.forEach(field => {
        bsc.getField(field.pos[0], field.pos[1]).children('.shipField').removeClass("active");
    });

    console.log(occupiedFields);
    occupiedFields = occupiedFields.filter(n => !shipFields.includes(n));
    console.log(occupiedFields);

    shipsLeft[data.type]++;
    refreshBoardView();
});

socket.on('connect', () => {
    $(".cover h1").html("Oczekiwanie na serwer...");
});

socket.on("players ready", () => {
    $(".cover").css({opacity: 0, pointerEvents: "none"});
});

socket.on("player idx", (idx) => {
    playerIdx = idx;
});

socket.on('turn update', (turnData) => {
    if (turnData.phase === "preparation") {
        $("#whosTurn").html("Faza przygotowań");
    } else {
        turnData.turn === playerIdx ? $("#whosTurn").html("Twoja tura") : $("#whosTurn").html("Tura przeciwnika");
    }
    

    timerDestination = turnData.timerToUTC;
    gamePhase = turnData.phase;
});

socket.on('player left', () => {
    window.location.replace("/");
});

// Update timer
setInterval(() => {
    if (timerDestination == null) {
        $("#timer").html("");
    } else {
        const UTCNow = Math.floor((new Date()).getTime() / 1000);

        const time = Math.abs(UTCNow - timerDestination);

        const minutes = Math.floor(time / 60).toLocaleString('pl-PL', {minimumIntegerDigits: 2, useGrouping: false});
        const seconds = (time - minutes * 60).toLocaleString('pl-PL', { minimumIntegerDigits: 2, useGrouping: false });

        $("#timer").html(`${minutes}:${seconds}`);
    }
}, 250);
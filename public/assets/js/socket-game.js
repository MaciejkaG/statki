const socket = io();

var playerIdx;
var timerDestination = null;
var gamePhase = "pregame";

socket.on('connect', () => {
    $(".cover h1").html("Oczekiwanie na serwer...");
});

socket.on("players ready", () => {
    $(".cover").css({opacity: 0, pointerEvents: "none"});
});

socket.on("player idx", (idx) => {
    console.log(idx);
    playerIdx = idx;
});

socket.on('turn update', (turnData) => {
    turnData.turn == playerIdx ? $("#whosTurn").html("Ty") : $("#whosTurn").html("Przeciwnik");

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
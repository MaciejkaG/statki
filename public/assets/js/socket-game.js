const socket = io();

var playerIdx;
var timerDestination = null;
var gamePhase = 'pregame';
var occupiedFields = [];

var shipsSunk = [0, 0, 0, 0];

var hits = 0;
var misses = 0;

var lastTimeClick = 0;

socket.emit('my theme', (theme) => {
    console.log('Received selected theme. Applying now.');
    $('#themeBackground').css('background-image', theme);
});

if ($(window).width() <= 820) {
    tippy('#board .field', {
        allowHTML: true,
        placement: "top",
        theme: "translucent",
        animation: "shift-toward-subtle",
        interactive: true,
        content: (reference) => {
            // Need to fix this

            console.log("a");
            let fieldData = `${$(reference).data('pos-x')}, ${$(reference).data('pos-y')}`;

            let pos = occupiedFields.find((elem) => elem.pos[0] == $(reference).data('pos-x') && elem.pos[1] == $(reference).data('pos-y'));

            if (pos) {
                return $('#removeTippyTemplate').html().replaceAll("[[FIELDPOS]]", fieldData);
            }

            return $('#mainTippyTemplate').html().replaceAll("[[FIELDPOS]]", fieldData);
        },
    });

    tippy('#secondaryBoard .field', {
        allowHTML: true,
        placement: "top",
        theme: "translucent",
        animation: "shift-toward-subtle",
        interactive: true,
        content: (reference) => {
            let fieldData = `${$(reference).data('pos-x')}, ${$(reference).data('pos-y')}`;

            return $('#secondaryTippyTemplate').html().replaceAll("[[FIELDPOS]]", fieldData);
        },
    });
}

$('#board .field').on('click', function () {
    if (new Date().getTime() / 1000 - lastTimeClick > 0.3 && $(window).width() > 820 && !postPrep) {
        socket.emit("place ship", selectedShip, $(this).data('pos-x'), $(this).data('pos-y'), shipRotation);
        lastTimeClick = new Date().getTime() / 1000;
    }
});

function manualPlace(posX, posY) {
    hoveredShip = null;
    refreshBoardView();
    socket.emit("place ship", selectedShip, posX, posY, shipRotation);
    lastTimeClick = new Date().getTime() / 1000;
}

$('#secondaryBoard .field').on('click', function () {
    if (new Date().getTime() / 1000 - lastTimeClick > 0.3 && $(window).width() > 820 && myTurn) {
        socket.emit("shoot", $(this).data('pos-x'), $(this).data('pos-y'));
        lastTimeClick = new Date().getTime() / 1000;
    }
});

function manualShoot(posX, posY) {
    socket.emit("shoot", posX, posY);
    lastTimeClick = new Date().getTime() / 1000;
}

$('.field').on('contextmenu', function () {
    if ($(this).hasClass('active') && new Date().getTime() / 1000 - lastTimeClick > 0.3) {
        let pos = occupiedFields.find((elem) => elem.pos[0] == $(this).data('pos-x') && elem.pos[1] == $(this).data('pos-y'));

        if (pos) {
            socket.emit("remove ship", pos.origin[0], pos.origin[1]);
            lastTimeClick = new Date().getTime() / 1000;
        }
    }
});

function manualRemove(posX, posY) {
    let pos = occupiedFields.find((elem) => elem.pos[0] == posX && elem.pos[1] == posY);

    if (pos) {
        socket.emit("remove ship", pos.origin[0], pos.origin[1]);
        lastTimeClick = new Date().getTime() / 1000;
    }
}

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
        hits++;
        updateAccuracy(getAccuracy());
    }
});

socket.on("shot missed", (victimIdx, posX, posY) => {
    if (victimIdx === playerIdx) {
        bsc.setField(posX, posY, "miss");
    } else {
        bsc.setFieldEnemy(posX, posY, "miss");
        misses++;
        updateAccuracy(getAccuracy());
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
            setTimeout(() => {
                bsc.setField(ship.posX + multips[0] * i, ship.posY + multips[1] * i, "sunken");
            }, i * 150);
        }
    } else {
        for (let i = 0; i < l; i++) {
            setTimeout(() => {
                bsc.setFieldEnemy(ship.posX + multips[0] * i, ship.posY + multips[1] * i, "sunken");
            }, i * 150);
        }

        shipsSunk[ship.type]++;
        updateShipsSunk();
    }
});

// Update timer
var updateTimer = setInterval(() => {
    if (timerDestination == null) {
        $("#timer").html("");
    } else {
        const UTCNow = Math.floor((new Date()).getTime() / 1000);

        const time = Math.max(timerDestination - UTCNow, 0);

        if (time < 10) {
            $("#timer").addClass("active");
        } else {
            $("#timer").removeClass("active");
        }

        const minutes = Math.floor(time / 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        const seconds = (time - minutes * 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });

        $("#timer").html(`${minutes}:${seconds}`);
    }
}, 250);

socket.on("game finished", (winnerIdx, oppName, oppNameStyle) => {
    socket.disconnect();
    $("#opponent").html(`Vs. <span class="important username" style="${oppNameStyle ? 'background: ' + oppNameStyle : ''}">${oppName}</span>`);

    if (winnerIdx === playerIdx) {
        $("#state").html(locale["Victory"]);
        $("#state").addClass("dynamic");
    } else {
        $("#state").html(locale["Defeat"]);
        $("#state").addClass("danger");
    }

    $(".cover").addClass("postGame");
    clearInterval(updateTimer);
    $("#timer").html(`00:00`);
    $(".cover").css({ opacity: 1, pointerEvents: "all" });
});

socket.on('connect', () => {
    $(".cover .title").html(window.locale["Waiting for the server"]);
});

socket.on("players ready", () => {
    $(".cover").css({ opacity: 0, pointerEvents: "none" });
});

socket.on("player idx", (idx) => {
    playerIdx = idx;
});

socket.on('turn update', (turnData) => {
    if (turnData.phase === "preparation") {
        $("#whosTurn").html(window.locale["Preparation phase"]);
        $(".boardSwitch").css("opacity", 0.3);
    } else {
        if (!postPrep) {
            $(".readyButton").css({ pointerEvents: 'none', opacity: 0.3 });

            $(".controlsOwnBoard").css("opacity", 0.3);

            $(".ownBoardInfo").addClass("changing");
            setTimeout(() => {
                $(".ownBoardInfo").html($(".lateBoardInfo").html());

                $(".ownBoardInfo").removeClass("changing");
            }, 200);
        }

        postPrep = true;
        myTurn = turnData.turn === playerIdx;
        turnData.turn === playerIdx ? $("#whosTurn").html(window.locale["Your turn"]) : $("#whosTurn").html(window.locale["Opponents turn"]);
        $(".boardSwitch").css("opacity", 1);

        if (turnData.turn === playerIdx) {
            Toastify({
                text: window.locale['Your turn'],
                duration: 5000,
                newWindow: true,
                gravity: "bottom",
                position: "right",
                stopOnFocus: true,
                className: "bshipstoast",
            }).showToast();
        }
    }

    timerDestination = turnData.timerToUTC;
    gamePhase = turnData.phase;
});

function updateLateInfo() {
    if (postPrep) {

    }
}

var currentAccuracy = 0;

function updateAccuracy(val) {
    val = Math.round(val);

    var obj = $(".ownBoardInfo #accuracy").get(0);

    const start = currentAccuracy !== null ? currentAccuracy : val;

    const range = val - start;
    var minTimer = 50;
    var stepTime = Math.abs(Math.floor(1000 / range));

    stepTime = Math.max(stepTime, minTimer);

    var startTime = new Date().getTime();
    var endTime = startTime + 1000;
    var timer;

    if (val < currentAccuracy) {
        $(".ownBoardInfo #accuracy").addClass("animatingDown");
    } else {
        $(".ownBoardInfo #accuracy").addClass("animatingUp");
    }

    currentAccuracy = val;

    const run = () => {
        var now = new Date().getTime();
        var remaining = Math.max((endTime - now) / 1000, 0);
        var value = Math.round(val - (remaining * range));
        obj.innerHTML = value + "%";
        if (value == val) {
            obj.innerHTML = Math.round(value) + "%";
            $(".ownBoardInfo #accuracy").removeClass("animatingDown animatingUp");

            clearInterval(timer);
        }
    };

    timer = setInterval(run, stepTime);
    run();
}

function getAccuracy() {
    return hits / (misses + hits) * 100;
}

function updateShipsSunk() {
    $("#singlemasted").html(4 - shipsSunk[0]);
    $("#twomasted").html(3 - shipsSunk[1]);
    $("#threemasted").html(2 - shipsSunk[2]);
    $("#fourmasted").html(1 - shipsSunk[3]);
}

function readyUp() {
    socket.emit("ready", () => {
        $(".readyButton").css({ pointerEvents: 'none', opacity: 0.3 });
    });
}

socket.on('player left', () => {
    window.location.replace("/");
});
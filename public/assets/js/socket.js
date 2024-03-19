const socket = io();

// Handling server-sent events
socket.on("joined", (nick) => {
    lockUI(true);
    $("#oppNameField").html(nick);
    switchView("preparingGame");
    lockUI(false);
});

socket.on("player left", () => {
    lockUI(true);
    switchView("mainMenuView");
    lockUI(false);
});

socket.on("gameReady", (gameId) => {
    setTimeout(() => {
        window.location.replace("/game?id=" + gameId);
    }, 2000);
});

var nickname;
var myProfile;

socket.emit("my profile data", (profile) => {
    myProfile = profile;
});

socket.emit("whats my nick", (myNickname) => {
    nickname = myNickname;
    $("#profileButton").html(nickname);
    console.log(nickname);
});

socket.on("game start", (gameInfo) => {
    let opp;
    if (gameInfo.players[0]!==nickname) {
        opp = gameInfo.players[0];
    } else {
        opp = gameInfo.players[1];
    }

    alert(`Grasz przeciwko: ${opp}`);
});

$("#createGameButton").on("click", function () {
    lockUI(true);
    socket.emit("create lobby", (response) => {
        switch (response.status) {
            case "ok":
                $("#createGameCode").val(response.gameCode);
                switchView("pvpCreateView");
                returnLock = true;
                lockUI(false);
                break;

            case "alreadyInLobby":
                $("#createGameCode").val(response.gameCode);
                switchView("pvpCreateView");
                lockUI(false);
                break;

            default:
                alert(`Wystąpił nieznany problem\nStatus: ${response.status}`);
                lockUI(false);
                break;
        }
    });
});

$("#leaveGameButton").on("click", function () {
    lockUI(true);
    window.location.reload();
    // socket.emit("leave lobby", (response) => {
    //     switch (response.status) {
    //         case "ok":
    //             switchView("mainMenuView");
    //             lockUI(false);
    //             break;

    //         case "youreNotInLobby":
    //             switchView("mainMenuView");
    //             lockUI(false);
    //             break;

    //         default:
    //             alert(`Wystąpił nieznany problem\nStatus: ${response.status}`);
    //             switchView("mainMenuView");
    //             lockUI(false);
    //             break;
    //     }
    // });
});

$("#pvpMenuButton").on("click", function () {
    switchView('pvpMenuView');
});

const form = document.getElementById('pvpJoinForm');
const input = document.getElementById('pvpJoinCode');

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value && input.value.length === 6) {
        lockUI(true);
        socket.emit("join lobby", input.value, (response) => {
            switch (response.status) {
                case "ok":
                    $("#oppNameField").html(response.oppNickname);
                    switchView("preparingGame");
                    lockUI(false);
                    break;

                //case "alreadyInLobby":
                //    $("#createGameCode").val(response.gameCode);
                //    switchView("pvpCreateView");
                //    lockUI(false);
                //    break;

                default:
                    alert(`Wystąpił nieznany problem\nStatus: ${response.status}`);
                    lockUI(false);
                    switchView("mainMenuView");
                    break;
            }
        });
        input.value = '';
    }
});
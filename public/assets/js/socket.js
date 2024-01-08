const socket = io();

socket.on("joined", () => {
    console.log("Someone joined the lobby!");
});

$("#createGameButton").on("click", function () {
    lockUI(true);
    socket.emit("create lobby", (response) => {
        switch (response.status) {
            case "ok":
                $("#createGameCode").val(response.gameCode);
                switchView("pvpCreateView");
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
    socket.emit("leave lobby", (response) => {
        switch (response.status) {
            case "ok":
                switchView("mainMenuView");
                lockUI(false);
                break;

            case "youreNotInLobby":
                switchView("mainMenuView");
                lockUI(false);
                break;

            default:
                alert(`Wystąpił nieznany problem\nStatus: ${response.status}`);
                switchView("mainMenuView");
                lockUI(false);
                break;
        }
    });
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
                    alert("Game joined!");
                    switchView("mainMenuView");
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
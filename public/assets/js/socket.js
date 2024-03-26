const socket = io();

// Handling server-sent events
socket.on("joined", (nick) => {
    returnLock = false;
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

socket.emit("my profile", (profile) => {
    // General profile data
    let options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    $("#playerSince").html(new Date(profile.profile.account_creation).toLocaleDateString("pl-PL", options));
    $("#nickname").html(profile.profile.nickname);

    // Profile stats
    $("#monthlyPlayed").html(profile.stats.monthly_matches);
    $("#totalPlayed").html(profile.stats.alltime_matches);
    $("#winrate").html(profile.stats.winrate !== null ? `${profile.stats.winrate}%` : "-");

    // Match history
    var matchHistory = profile.matchHistory;
    var matchHistoryDOM = "";

    options = { hour: '2-digit', minute: '2-digit', time: 'numeric', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    for (let i = 0; i < matchHistory.length; i++) {
        const match = matchHistory[i];

        let date = new Date(match.date).toLocaleDateString(undefined, options);

        const seconds = (match.duration - minutes * 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        const minutes = Math.floor(match.duration / 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        
        const duration = `${minutes}:${seconds}`;

        matchHistoryDOM += `<div class="match" data-matchid="${match.match_id}"><div><h1 class="dynamic${match.won === 1 ? "" : " danger"}">${match.won === 1 ? "Zwycięstwo" : "Porażka"}</h1><span> vs. ${match.match_type === "pvp" ? match.opponent : "AI"}</span></div><h2 class="statsButton">Kliknij by wyświetlić statystyki</h2><span>${date}</span><br><span>${duration}</span></div>`;
    }

    if (matchHistoryDOM === "") {
        matchHistoryDOM = `<h2>${locale["No matches played"]}</h2>`;
    }

    $(".matchList").html(matchHistoryDOM);
});

socket.emit("whats my nick", (myNickname) => {
    nickname = myNickname;
    $("#profileButton").html(nickname);
    console.log(nickname);
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
                alert(`${locale["Unknown error occured"]}\n${locale["Status:"]} ${response.status}`);
                lockUI(false);
                break;
        }
    });
});

$("#leaveGameButton").on("click", function () {
    lockUI(true);
    window.location.reload();
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
                    alert(`${locale["Unknown error occured"]}\n${locale["Status:"]} ${response.status}`);
                    lockUI(false);
                    switchView("mainMenuView");
                    break;
            }
        });
        input.value = '';
    }
});
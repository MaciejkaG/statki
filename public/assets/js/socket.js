switchView("mainMenuView");

const socket = io();

// Handling server-sent events
socket.on("joined", (nick) => {
    returnLock = false;
    lockUI(true);
    $("#oppNameField").html(nick);
    switchView("preparingGame");
    lockUI(false);

    console.log("Player joined the game:", nick);
});

socket.on("player left", () => {
    lockUI(true);
    switchView("mainMenuView");
    lockUI(false);

    console.log("Player left the game");
});

socket.on("gameReady", (gameId) => {
    console.log("Game is ready, redirecting in 2 seconds. Game ID:", gameId);
    setTimeout(() => {
        console.log("Redirecting...");
        window.location.replace("/game?id=" + gameId);
    }, 2000);
});

var nickname;

socket.emit('locale options', (langs) => {
    console.log("Fetching available locale options");
    let menu = "";
    langs.forEach(lang => {
        menu += `<option value="${lang.id}">${lang.name}</option>`;
    });

    $("#languages").html(menu);
    console.log("Locale options fetched");
});

$("#languages").on("change", function() {
    lockUI(true);
    console.log("Switching language to", $(this).val());
    socket.emit("change locale", $(this).val(), (response) => {
        switch (response.status) {
            case "ok":
                console.log("Switched languages, refreshing");
                window.location.reload();
                break;

            default:
                alert(`${window.locale["Unknown error occured"]}\n${window.locale["Status:"]} ${response.status}`);
                lockUI(false);
                break;
        }
    });
});

socket.emit("my profile", (profile) => {
    console.log("Received user data. UID:", profile.uid);

    // General profile data
    let options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    $("#playerSince").html(new Date(profile.profile.account_creation).toLocaleDateString(undefined, options));
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

        const minutes = Math.floor(match.duration / 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        const seconds = (match.duration - minutes * 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        
        const duration = `${minutes}:${seconds}`;

        matchHistoryDOM += `<div class="match" data-matchid="${match.match_id}"><div><h1 class="dynamic${match.won === 1 ? "" : " danger"}">${match.won === 1 ? window.locale["Victory"] : window.locale["Defeat"]}</h1><span> vs. ${match.match_type === "pvp" ? match.opponent : "AI"}</span></div><h2 class="statsButton">${window.locale["Click to view match statistics"]}</h2><span>${date}</span><br><span>${duration}</span></div>`;
    }

    if (!matchHistoryDOM) {
        matchHistoryDOM = `<h2>${window.locale["No matches played"]}</h2>`;
    }

    $(".matchList").html(matchHistoryDOM);
    console.log("Profile data fetched successfully");
});

socket.emit("whats my nick", (myNickname) => {
    nickname = myNickname;
    $("#profileButton").html(nickname);
    console.log("Received player nickname:", myNickname);
});

$("#createGameButton").on("click", function () {
    lockUI(true);
    console.log("Creating a lobby...");
    socket.emit("create lobby", (response) => {
        switch (response.status) {
            case "ok":
                console.log("Lobby created");
                $("#createGameCode").val(response.gameCode);
                switchView("pvpCreateView");
                returnLock = true;
                lockUI(false);
                break;

            case "alreadyInLobby":
                console.log("Lobby creation failed (player is already in a lobby)");
                $("#createGameCode").val(response.gameCode);
                switchView("pvpCreateView");
                lockUI(false);
                break;

            default:
                console.log("Lobby creation failed (unknown)");
                alert(`${window.locale["Unknown error occured"]}\n${window.locale["Status:"]} ${response.status}`);
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

$("#logout").on("click", function() {
    lockUI(true);
    socket.emit("logout");
    window.location.reload();
});

const form = document.getElementById('pvpJoinForm');
const input = document.getElementById('pvpJoinCode');

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value && input.value.length === 6) {
        lockUI(true);
        console.log("Joining a lobby with code:", input.value);
        socket.emit("join lobby", input.value, (response) => {
            switch (response.status) {
                case "ok":
                    console.log("Joined a lobby by:", response.oppNickname);
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
                    alert(`${window.locale["Unknown error occured"]}\n${window.locale["Status:"]} ${response.status}`);
                    lockUI(false);
                    switchView("mainMenuView");
                    break;
            }
        });
        input.value = '';
    }
});
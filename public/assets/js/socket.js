switchView("mainMenuView");

let profileLoaded;

const socket = io();

tippy('#shopButton', {
    placement: 'bottom',
    theme: 'dark',
    followCursor: 'horizontal',
    animation: 'scale-subtle',
    content: window.locale['These are masts, a currency you can earn by leveling up (by playing Vs AI games) Click on the masts icon to open the shop!']
});

tippy('#profileButton', {
    placement: 'bottom',
    theme: 'translucent',
    animation: 'scale-subtle',
    allowHTML: true,
    arrow: false,
    interactive: true,
    content: `
    <span onclick="switchView('profileView')">${window.locale['My profile']}</span><br>
    <span onclick="switchView('inventoryView')">${window.locale['Inventory']}</span>
    `
});

// Handling server-sent events
socket.on("joined", (nick, oppNameStyle) => {
    returnLock = false;
    lockUI(true);
    $("#oppNameField").html(nick);
    $("#oppNameField").css('background', oppNameStyle);
    lockUI(false);
    switchView("preparingGame");

    console.log("Player joined the game:", nick);
});

socket.on("player left", () => {
    lockUI(false);
    switchView("mainMenuView");

    console.log("Player left the game");
});

socket.on("game ready", (gameId) => {
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

var currentMasts = 0;

socket.emit("my profile", (profile) => {
    console.log("Received user data. UID:", profile.uid);
    console.log("Profile data:", profile);

    // General profile data
    let options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    $("#playerSince").html(new Date(profile.profile.account_creation).toLocaleDateString(undefined, options));
    $(".nickname").html(profile.profile.nickname);

    // Profile stats
    $("#monthlyPlayed").html(profile.stats.monthly_matches);
    $("#totalPlayed").html(profile.stats.alltime_matches);
    $("#winrate").html(profile.stats.winrate !== null ? `${profile.stats.winrate}%` : "-");

    $("#xpbar").css('width', `${profile.profile.levelProgress}%`);
    $("#level").html(profile.profile.level);
    $("#masts").html(profile.profile.masts.toLocaleString(undefined));
    currentMasts = profile.profile.masts;

    $('.nickname.username').css('background', profile.profile.nameStyle);

    if (profile.profile.xp_boost_until) {
        $('#xpbooststatus').css('display', 'initial');

        options = { hour: '2-digit', minute: '2-digit', time: 'numeric', weekday: 'long', month: 'long', day: 'numeric' };

        tippy('#xpbooststatus', {
            theme: 'dark',
            followCursor: 'horizontal',
            animation: 'scale-subtle',
            content: `${window.locale['Until:']} ${new Date(profile.profile.xp_boost_until).toLocaleDateString(undefined, options) }`
        });
    }

    tippy('#levelcontainer', {
        theme: 'dark',
        followCursor: 'horizontal',
        animation: 'scale-subtle',
        content: `${profile.profile.xp} / ${profile.profile.levelThreshold}`
    });

    // Show news if user didn't read them already.
    if (!profile.profile.viewed_news) { // profile.profile.viewed_news would be 0 (falsy) if user didn't read the news
        openNewsModal();
    }

    // Match history
    const matchHistory = profile.matchHistory;
    let matchHistoryDOM = "";

    options = { hour: '2-digit', minute: '2-digit', time: 'numeric', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    for (let i = 0; i < matchHistory.length; i++) {
        const match = matchHistory[i];

        let date = new Date(match.date).toLocaleDateString(undefined, options);

        const minutes = Math.floor(match.duration / 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        const seconds = (match.duration - minutes * 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
        
        const duration = `${minutes}:${seconds}`;

        matchHistoryDOM += `<div class="match" data-matchid="${match.match_id}" onclick="window.open(\`/match/\${$(this).data('matchid')}\`, '_blank')"><div><h1 class="dynamic${match.won === 1 ? "" : " danger"}">${match.won === 1 ? window.locale["Victory"] : window.locale["Defeat"]}</h1><span style="display: flex;align-items: center;gap: 0.5rem;"> vs. <span ${match.match_type === 'pvp' ? `class="username" style="background:${match.opponent_name_style}"` : 'class="important"'}>${match.match_type === "pvp" ? match.opponent : `AI (${match.ai_type})`}</span></span>${match.xp ? `<span class="xpincrease">+${match.xp}XP</span>` : ''}</div><h2 class="statsButton">${window.locale["Click to view match statistics"]}</h2><span>${date}</span><br><span>${duration}</span></div>`;
    }

    if (!matchHistoryDOM) {
        matchHistoryDOM = `<h2>${window.locale["No matches played"]}</h2>`;
    }

    $(".matchList").html(matchHistoryDOM);

    profileLoaded = true;
    console.log("Profile data fetched and processed successfully");
});

let lastLoad = new Date().getTime();
let page = 2;
let allMatches;
let loadLock = false;

const endReached = () => {
    console.log('Match list end reached.');
    $(".matchList").html($(".matchList").html() + `<h2>${window.locale["Thats all of your matches Theres nothing more to see here"]}</h2>`);
    allMatches = true;
}

$(window).scroll(function () {
    if ($(window).scrollTop() + $(window).height() == $(document).height() && profileLoaded && !allMatches && !loadLock && activeView === 'profileView' && new Date().getTime() - lastLoad > 300) {
        loadLock = true;

        console.log('Requesting match list continuation. Page:', page);
        socket.emit("match list", page, (matchlist) => {
            if (matchlist === null) {
                endReached();
                return;
            }

            console.log('Received match list continuation data:', matchlist);

            var matchHistory = matchlist;
            var matchHistoryDOM = "";

            options = { hour: '2-digit', minute: '2-digit', time: 'numeric', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

            for (let i = 0; i < matchHistory.length; i++) {
                const match = matchHistory[i];

                let date = new Date(match.date).toLocaleDateString(undefined, options);

                const minutes = Math.floor(match.duration / 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });
                const seconds = (match.duration - minutes * 60).toLocaleString(undefined, { minimumIntegerDigits: 2, useGrouping: false });

                const duration = `${minutes}:${seconds}`;

                matchHistoryDOM += `<div class="match" data-matchid="${match.match_id}" onclick="window.open(\`/match/\${$(this).data('matchid')}\`, '_blank')"><div><h1 class="dynamic${match.won === 1 ? "" : " danger"}">${match.won === 1 ? window.locale["Victory"] : window.locale["Defeat"]}</h1><span ${match.match_type === 'pvp' ? `class="username" style="${match.opponent_name_style}"` : ''}> vs. ${match.match_type === "pvp" ? match.opponent : "<span class=\"important\">AI (" + match.ai_type + ")</span>"}</span>${match.xp ? `<span class="xpincrease">+${match.xp}XP</span>` : ''}</div><h2 class="statsButton">${window.locale["Click to view match statistics"]}</h2><span>${date}</span><br><span>${duration}</span></div>`;
            }

            $(".matchList").html($(".matchList").html() + matchHistoryDOM);

            if (matchHistory.length < 10) {
                endReached();
            }

            console.log('Processed match list data. Page:', page);

            lastLoad = new Date().getTime();
            page++;
            loadLock = false;
        });
    }
});

function showMatchInfo(matchId) {
    socket.emit('match info', matchId, (matchInfo) => {
        console.log(matchInfo);
    });
}

socket.emit('get shop', (shopItems) => {
    console.log(`Received shop data.`);
    console.log('Shop items data:', shopItems);

    for (let i = 0; i < shopItems.length; i++) {
        const item = shopItems[i];

        const itemHTML = `
            <div class="item" style="--gradient-colors: ${item.item_data.gradientColors};--background:${item.item_data.background};">
                <div class="background"></div>
                <div class="overlay">
                    <div class="finishBox">
                        <img src="/assets/img/check-circle.svg" alt="Item bought!">
                    </div>
                    <div class="checkoutBox">
                        <h2>${window.locale['Are you sure you want to buy this?']}</h2>
                        <span>${window.locale['This will cost you']} <span class="masts"><img src="/assets/img/masts-logo.png" alt="Masts" style="height: 0.9em;"> ${item.price.toLocaleString(undefined)} ${window.locale['masts']}</span></span>
                        <div>
                            <button class="cancelCheckout">${window.locale['Cancel']}</button>
                            <button class="buyItem" onclick="buyShopItem(this, ${item.price}, ${item.item_id})">${window.locale['Confirm']}</button>
                        </div>
                    </div>
                    <div class="overlayBase">
                        <h1>${item.name}</h1>
                        <p>${item.description}</p>
                    </div>
                    <div class="overlayBase">
                        <button class="startCheckout">
                            <img src="/assets/img/shopping-cart.svg" alt="Shopping cart icon">
                        </button>
                    </div>
                </div>
            </div>
        `;

        switch (item.category) {
            case 'theme_pack':
                document.getElementById('themepacks').innerHTML += itemHTML;
                break;

            case 'name_style':
                document.getElementById('namestyles').innerHTML += itemHTML;
                break;

            case 'lootbox':
                document.getElementById('statboxes').innerHTML += itemHTML;
                break;
        }
    }

    $('.cancelCheckout').on('click', function () {
        $(this).closest('.item').removeClass('checkout');
    });

    $('.startCheckout').on('click', function () {
        $('.item').removeClass('checkout');
        $(this).closest('.item').addClass('checkout');
    });

    console.log(`Shop items received and processed successfully.`);
});

function buyShopItem(el, price, itemId) {
    const cantBuy = () => {
        $(el).closest('.item').removeClass('finished checkout');

        Toastify({
            text: window.locale['You cannot buy this item'],
            duration: 5000,
            newWindow: true,
            gravity: "bottom",
            position: "right",
            stopOnFocus: true,
            className: "bshipstoast",
        }).showToast();
    };

    if (currentMasts < price) {
        cantBuy();
        return;
    }

    lockUI(true);
    socket.emit("buy shop item", itemId, (result) => {
        if (result) {
            reloadInventory();

            increaseDisplayedMasts(-price);
            $(el).closest('.item').addClass('finished');

            setTimeout(() => {
                $(el).closest('.item').removeClass('finished checkout');
            }, 1500);
        } else {
            cantBuy();
        }

        lockUI(false);
    });
}

reloadInventory();

function reloadInventory() {
    socket.emit('my inventory', (items) => {
        console.log(`Received inventory data.`);
        console.log('Inventory items data:', items);

        let itemsHTML = '';

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            let itemHTML;

            switch (item.category) {
                case 'theme_pack':
                    itemHTML = `
                        <div class="item">
                            <div class="options">
                                <button onclick="applyTheme(${item.item_id})">${window.locale['Apply']}</button>
                            </div>
                            <div class="content">
                                <h2>${window.locale['Theme pack']}</h2>
                                <h1>${item.name}</h1>
                                <span>${item.description}</span>
                            </div>
                        </div>
                    `;
                    break;

                case 'name_style':
                    itemHTML = `
                        <div class="item">
                            <div class="options">
                                <button onclick="applyNameStyle(${item.item_id})">${window.locale['Apply']}</button>
                            </div>
                            <div class="content">
                                <h2>${window.locale['Name style']}</h2>
                                <h1>${item.name}</h1>
                                <span>${item.description}</span>
                            </div>
                        </div>
                    `;
                    break;

                case 'lootbox':
                    itemHTML = `
                        <div class="item">
                            <div class="options">
                                <button onclick="openLootbox('${item.inventory_item_id}')">${window.locale['Open']}</button>
                            </div>
                            <div class="content">
                                <h2>Statbox</h2>
                                <h1>${item.name}</h1>
                                <span>${item.description}</span>
                            </div>
                        </div>
                    `;
                    break;

                case 'xp_boost':
                    itemHTML = `
                        <div class="item">
                            <div class="options">
                                <button onclick="useXPBoost('${item.inventory_item_id}')">${window.locale['Use']}</button>
                            </div>
                            <div class="content">
                                <h2>${window.locale['XP Boost']}</h2>
                                <h1>${item.name}</h1>
                                <span>${item.description}</span>
                            </div>
                        </div>
                    `;
                    break;
            }

            itemsHTML += itemHTML;
        }

        if (itemsHTML.length === 0) {
            itemsHTML = `<h2>${window.locale['Nothing to see here']}</h2>`;
        }

        $('#inventoryitems').html(itemsHTML);

        console.log(`Inventory items received and processed successfully.`);
    });
}

socket.emit('my theme', (theme) => {
    console.log('Received selected theme. Applying now.');
    $('#themeBackground').css('background-image', theme);
});

function applyTheme(themeId) {
    lockUI(true);
    socket.emit('set theme', themeId, (response) => {
        if (response) {
            $('#themeBackground').css('opacity', '0');
            setTimeout(() => {
                $('#themeBackground').css('background-image', response);
                $('#themeBackground').css('opacity', '0.6');
                lockUI(false);
            }, 1000);
        } else if (response === null && themeId === null) {
            $('#themeBackground').css('opacity', '0');
            lockUI(false);
        } else {
            Toastify({
                text: window.locale['Operation failed'],
                duration: 5000,
                newWindow: true,
                gravity: "bottom",
                position: "right",
                stopOnFocus: true,
                className: "bshipstoast",
            }).showToast();
            lockUI(false);
        }
    });
}

function applyNameStyle(nameStyleId) {
    lockUI(true);
    socket.emit('set name style', nameStyleId, (response) => {
        lockUI(false);
        if (response) {
            window.location.href = '/profile';
        } else if (response === null && nameStyleId === null) {}
        else {
            Toastify({
                text: window.locale['Operation failed'],
                duration: 5000,
                newWindow: true,
                gravity: "bottom",
                position: "right",
                stopOnFocus: true,
                className: "bshipstoast",
            }).showToast();
        }
    });
}

function openLootbox(lootboxId) {
    lockUI(true);
    socket.emit('open lootbox', lootboxId, (response) => {
        lockUI(false);
        if (response) {
            $('#droppedItem').css({
                '--gradient-colors': response.item_data.gradientColors,
                '--background': response.item_data.background
            });

            let itemType;
            switch (response.category) {
                case 'theme_pack':
                    itemType = window.locale['Theme pack'];
                    break;

                case 'name_style':
                    itemType = window.locale['Name style'];
                    break;

                case 'xp_boost':
                    itemType = window.locale['XP boost'];
                    break;
            }

            $('#droppedItemType').html(itemType);
            $('#droppedItemName').html(response.name);
            $('#droppedItemDescription').html(response.description);

            openLootboxModal();
            reloadInventory();
        } else if (response === null && lootboxId === null) {} 
        else {
            Toastify({
                text: window.locale['Operation failed'],
                duration: 5000,
                newWindow: true,
                gravity: "bottom",
                position: "right",
                stopOnFocus: true,
                className: "bshipstoast",
            }).showToast();
        }
    });
}

function useXPBoost(itemId) {
    lockUI(true);
    socket.emit('use xp boost', itemId, (response) => {
        lockUI(false);
        if (response) {
            reloadInventory();
            $('#xpbooststatus').css('display', 'initial');
        } else {
            Toastify({
                text: window.locale['Operation failed'],
                duration: 5000,
                newWindow: true,
                gravity: "bottom",
                position: "right",
                stopOnFocus: true,
                className: "bshipstoast",
            }).showToast();
        }
    });
}

document.getElementById('newsModalContainer').addEventListener('click', function (event) {
    if (event.target === event.currentTarget) {
        closeNewsModal();
    }
});

function closeNewsModal() {
    $('.newsModalContainer').addClass('unactive');
}

function openNewsModal() {
    $('.newsModalContainer').removeClass('unactive');
    $('.newsModalContainer').addClass('active');
}

document.getElementById('lootboxOpenContainer').addEventListener('click', function (event) {
    if (event.target === event.currentTarget) {
        closeLootboxModal();
    }
});

function closeLootboxModal() {
    $('#lootboxOpenContainer').addClass('unactive');
    setTimeout(() => {
        $('#lootboxOpenContainer').removeClass('active unactive');
    }, 300);
}

function openLootboxModal() {
    $('#lootboxOpenContainer').removeClass('unactive');
    $('#lootboxOpenContainer').addClass('active');
}

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
                console.log("Lobby created, code:", response.gameCode);
                $("#createGameCode").val(response.gameCode);
                lockUI(false);
                switchView("pvpCreateView");
                returnLock = true;
                break;

            case "alreadyInLobby":
                console.log("Lobby creation failed (player is already in a lobby)");
                $("#createGameCode").val(response.gameCode);
                lockUI(false);
                switchView("pvpCreateView");
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

$("#logout").on("click", function() {
    lockUI(true);
    socket.emit("logout");
    window.location.reload();
});

$("#pveDifficulty").on("change", function() {
    switch (this.value) {
        case 'simple':
            $('#difficultyDescription').html(locale["Simple description"]);
            break;

        case 'smart':
            $('#difficultyDescription').html(locale["Smart description"]);
            break;
    
        case 'overkill':
            $('#difficultyDescription').html(locale["Overkill description"]);
            break;

        default:
            $('#difficultyDescription').html('');
            break;
    }
});

const joinForm = document.getElementById('pvpJoinForm');
const joinCodeInput = document.getElementById('pvpJoinCode');

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (joinCodeInput.value && joinCodeInput.value.length === 6) {
        lockUI(true);
        console.log("Joining a lobby with code:", joinCodeInput.value);
        socket.emit("join lobby", joinCodeInput.value, (response) => {
            switch (response.status) {
                case "ok":
                    console.log("Joined a lobby by:", response.oppNickname);
                    $("#oppNameField").html(response.oppNickname);
                    $("#oppNameField").css('background', response.oppNameStyle);
                    lockUI(false);
                    switchView("preparingGame");
                    break;

                default:
                    alert(`${window.locale["Unknown error occured"]}\n${window.locale["Status:"]} ${response.status}`);
                    lockUI(false);
                    switchView("mainMenuView");
                    break;
            }
        });
        joinCodeInput.value = '';
    }
});

const pveForm = document.getElementById('pveCreateForm');
const pveDifficultyElem = document.getElementById('pveDifficulty');

pveForm.addEventListener('submit', (e) => {
    const pveDifficulty = pveDifficultyElem.value;
    e.preventDefault();
    if (pveDifficulty) {
        lockUI(true);
        console.log("Creating a PvE game with difficulty:", pveDifficulty);
        socket.emit("create pve", pveDifficulty, (response) => {
            switch (response.status) {
                case "ok":
                    console.log("Joined a PvE lobby");
                    $("#oppNameField").html(`AI (${pveDifficulty})`);
                    lockUI(false);
                    switchView("preparingGame");
                    break;

                default:
                    alert(`${window.locale["Unknown error occured"]}\n${window.locale["Status:"]} ${response.status}`);
                    lockUI(false);
                    switchView("mainMenuView");
                    break;
            }
        });
        joinCodeInput.value = '';
    }
});

// const isInStandaloneMode = () =>
//     (window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone) || document.referrer.includes('android-app://');

// if (isInStandaloneMode()) {
//     alert("Thanks for using the PWA!");
// }

function increaseDisplayedMasts(increaseBy) {
    const obj = document.getElementById('masts');
    const start = currentMasts;
    const end = start + increaseBy;
    const duration = 1000;

    currentMasts = end;

    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString(undefined);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}
// Cycling the messages every 5 seconds
const generalQuery = '.social .collapsed span.el';

var activeChatFriendId;
let conversationCache = {};

let i = -1;
const cycleMessages = () => {
    if (i + 1 < $(generalQuery).length) {
        i++;
    } else {
        i = 0;
    }

    $(generalQuery).removeClass('active');
    setTimeout(() => {
        $(generalQuery).css('display', 'none');
        const currentElement = $($(generalQuery).get(i));
        currentElement.css('display', 'inherit');
        // For some reason I need to use setTimeout because it doesn't animate otherwise.
        setTimeout(() => {
            currentElement.addClass('active');
        }, 10);
    }, 300);
};

cycleMessages();
setInterval(cycleMessages, 5000);

// Some UI stuff
$('.social').hover(function() {
    if ($(window).width() > 820 && !$('.social *').is(":focus")) {
        anime({
            targets: [
                '.social .expanded h1.mainTitle',
                '.social .expanded .inviteFriends',
                '.social .expanded button.topBtn',
                '.social .expanded .friendsList .el'
            ],
            easing: 'easeOutQuint',
            translateX: [100, 0],
            opacity: [0, 1],
            duration: 500,
            delay: anime.stagger(150, { start: 200 })
        });
    }
}, function () {
    if (!$('.social *').is(":focus")) closeCards();
});

$('.social').on('focusout', function () {
    if (!$('.social').is(":focus") && !$('.social').is(":hover")) closeCards();
});

const messageBox = document.getElementById('messageBox');
messageBox.addEventListener('keydown', (e) => {
    // If Enter has been pressed without shift
    if (e.key === 'Enter' && !e.shiftKey) {
        // Prevent making an indent in the textarea.
        e.preventDefault();

        socket.emit('send message', activeChatFriendId, messageBox.value, (success) => {
            if (!success) return;

            addMessage(activeChatFriendId, false, messageBox.value);
            messageBox.value = '';
        });
    }
});

const buttonsAnimation = {
    easing: 'easeOutExpo',
    translateY: [50, 0],
    opacity: [0, 1],
    duration: 500,
    delay: anime.stagger(100)
};

// Socket connections and data management
const viewIdToActivity = {
    mainMenuView: 'Main menu',
    vsAiView: 'Main menu',
    pvpMenuView: 'Main menu',
    pvpCreateView: 'Main menu',
    pvpJoinView: 'Main menu',
    prepairingGame: 'Main menu',
    profileView: 'My profile',
    shopView: 'Shop',
    inventoryView: 'Inventory',
    dropRatesView: 'Main menu',
    settingsView: 'Settings',
};
// When "switchviews" event is dispatched from the SPA library, update the activity on the server.
document.addEventListener('switchviews', function (e) {
    if (viewIdToActivity[e.detail.destination]) {
        socket.emit('set activity', viewIdToActivity[e.detail.destination]);
    }
});

// Updating the friends list and friend requests.
function updateFriendsList() {
    console.log("Downloading friends list and friend requests now...");
    socket.emit("my friends", ({ friends: friendsList, requests }) => {
        console.log("Successfully received the friends list and friend requests. Processing...");
        // Find all existing friend elements in the DOM
        let friendElements = document.querySelectorAll('#friendsList .el');

        // Create a map of friend elements by their IDs
        let elementMap = {};
        friendElements.forEach(el => {
            const friendId = el.getAttribute('data-friend-id');
            if (friendId) {
                elementMap[friendId] = el;
            }
        });

        // Find out how many friends are online right now.
        const friendsOnline = friendsList.filter(friend => friend.lastOnline && friend.lastOnline.secondsAgo < 5).length;
        // Show this count in the Social tab quick access.
        document.getElementById('friendsOnline').innerHTML = friendsOnline;

        // Sort friendsList by status: online > ingame > offline
        friendsList.sort((a, b) => {
            const getStatusPriority = (friend) => {
                if (!friend.lastOnline) return 3; // Offline
                if (friend.lastOnline.secondsAgo < 5) return 1; // Online
                if (['Vs. AI', 'PvP'].includes(friend.lastOnline.activity)) return 2; // Ingame
                return 3; // Offline
            };
            return getStatusPriority(a) - getStatusPriority(b);
        });

        // Keep track of friends that should remain in the DOM
        let remainingFriendIds = new Set(friendsList.map(friend => friend.friend_id));

        const friendsListContainer = document.getElementById('friendsList');

        // Update or add elements for each friend
        friendsList.forEach(friend => {
            const friendId = friend.friend_id;
            const nickname = friend.nickname;
            const lastOnline = friend.lastOnline;

            let statusText = window.locale['Offline'];
            let statusClass = 'offline';

            // If the last online status is from less than 5 seconds ago, we assume the user is online
            if (lastOnline && lastOnline.secondsAgo < 5) {
                // We now determine whether they are playing or just online
                console.log(lastOnline.activity);
                if (['Vs. AI', 'PvP'].includes(lastOnline.activity)) {
                    statusText = window.locale[`In game - ${lastOnline.activity}`];
                    statusClass = 'ingame';
                } else {
                    statusText = window.locale[`Online - ${lastOnline.activity}`];
                    statusClass = 'online';
                }
            }

            let friendEl = elementMap[friendId];

            if (friendEl) {
                // Only update parts that have changed
                let nameSpan = friendEl.querySelector('.status span:first-child');
                if (nameSpan.textContent !== nickname) {
                    nameSpan.textContent = nickname;
                }

                let statusSpan = friendEl.querySelector('.status span:last-child');
                if (statusSpan.textContent !== statusText || !statusSpan.classList.contains(statusClass)) {
                    if (statusText !== window.locale['Offline'] && statusSpan.textContent === window.locale['Offline']) { // If user just went online.
                        // A friend just went online or playing after being offline.
                        // We notify the user about it.
                        sendSocialToast(window.locale['Friend online'], nickname + ' ' + window.locale['just went online'], window.locale['Your friend just went online! You can message them through the Social tab'])
                    }

                    statusSpan.textContent = statusText;
                    statusSpan.className = statusClass;
                }
            } else {
                // Create a new friend element if it doesn't exist
                friendEl = document.createElement('div');
                friendEl.classList.add('el');
                friendEl.setAttribute('data-friend-id', friendId);

                friendEl.innerHTML = `
                    <div class="status">
                        <span class="friendNickname">${nickname}</span>
                        <span class="${statusClass}">${statusText}</span>
                    </div>
                    <div class="buttons">
                        <button onclick="openChat(this)">${window.locale['Chat']}</button>
                        <button>${window.locale['Duel']}</button>
                        <button class="danger" onclick="removeFriend(this)">${window.locale['Remove friend']}</button>
                    </div>
                `;

                // Append the new friend element to the friends list
                friendsListContainer.appendChild(friendEl);

                // Add the animation event to the new element.
                $(friendEl).hover(function (e) {
                    if ($(window).width() > 820) {
                        anime({
                            ...buttonsAnimation,
                            targets: e.target.querySelectorAll('.buttons button')
                        });
                    }
                }, function () { }); // It needs the second function not to glitch for some reason
            }
        });

        // Remove elements for friends no longer in the list
        friendElements.forEach(el => {
            const friendId = el.getAttribute('data-friend-id');
            if (!remainingFriendIds.has(friendId)) {
                el.remove(); // Remove from the DOM if the friend is no longer in the list
            }
        });

        // Check if the current DOM order is already correct
        let currentOrder = Array.from(friendsListContainer.querySelectorAll('.el')).map(el => el.getAttribute('data-friend-id'));
        let expectedOrder = friendsList.map(friend => friend.friend_id);

        if (JSON.stringify(currentOrder) !== JSON.stringify(expectedOrder)) {
            // Reorder the DOM elements only if the order is wrong
            friendsList.forEach(friend => {
                let friendEl = elementMap[friend.friend_id];
                friendsListContainer.appendChild(friendEl);
            });
        }

        console.log('Successfully received and processed the friends list.');

        // Friend requests managing here
        console.log('Processing friend requests now...');
        const requestsEl = document.getElementById('requests');
        requestsEl.innerHTML = `<h3>${window.locale['Incoming']}</h3>`;
        
        const incoming = requests.filter(x => x.incoming);
        const outgoing = requests.filter(x => !x.incoming);

        for (let i = 0; i < incoming.length; i++) {
            const request = incoming[i];
            
            requestsEl.innerHTML += `<div class="el" data-user-id="${request.user_id}"><span>${request.nickname}</span><div><span class="material-symbols-outlined confirm" onclick="confirmRequest(this)">check</span><span class="material-symbols-outlined decline" onclick="declineRequest(this)">close</span></div></div>`;
        }

        if (!incoming.length) {
            requestsEl.innerHTML += `<span class="placeholder">${window.locale['Nothing to see here']}</span>`;
        }

        requestsEl.innerHTML += `<h3>${window.locale['Outgoing']}</h3>`;
        for (let i = 0; i < outgoing.length; i++) {
            const request = outgoing[i];

            requestsEl.innerHTML += `<div class="el" data-user-id="${request.user_id}"><span>${request.nickname}</span><div><span class="material-symbols-outlined decline" onclick="declineRequest(this)">close</span></div></div>`;
        }

        if (!outgoing.length) {
            requestsEl.innerHTML += `<span class="placeholder">${window.locale['Nothing to see here']}</span>`;
        }

        console.log('Successfully processed the friend requests list.');
    });
}

updateFriendsList();
setInterval(updateFriendsList, 3000);

// Declare a variable that will contain the last notification timestamp
let lastMessage = 0;
socket.on('new message', (fromId, nickname, content) => {
    addMessage(fromId, true, content);
    // If the new message is not in the currently opened chat, and there was no notification for the past 15 seconds (to prevent flooding the screen with notifications).
    if (fromId !== activeChatFriendId && new Date().getTime() / 1000 - lastMessage > 15) {
        sendSocialToast(window.locale['New message'], window.locale['New message from a friend'], nickname + ' ' + window.locale['just sent you a message! You can read it in the Social tab']);
        // Update last notification timestamp.
        lastMessage = new Date().getTime() / 1000;
    }
});

// Declare a variable that will contain the last notification timestamp
let lastRequest = 0;
socket.on('new friend request', (nickname) => {
    // If there was no notification for the past 15 seconds (to prevent flooding the screen with notifications).
    if (new Date().getTime() / 1000 - lastMessage > 15) {
        sendSocialToast(window.locale['Friend requests'], window.locale['New friend request'], nickname + ' ' + window.locale['invited you to become friends. You can respond to the invitation in the Social tab']);
        // Update last notification timestamp.
        lastMessage = new Date().getTime() / 1000;
    }
});

// Confirms a friend request through socket.io
function sendRequest() {
    const friendId = $('#uidInput').val();

    socket.emit('invite to friends', friendId, (result) => {
        if (result) {
            $('#uidInput').val('');
            updateFriendsList();
            openRequests();
        }
    });
}

// Confirms a friend request through socket.io
function confirmRequest(el) {
    const friendId = $(el).parents('.el').data('user-id');

    $(el).parents('.el').hide();
    socket.emit('accept friendship', friendId, (result) => {
        if (result) {
            $(el).parents('.el').remove();
            updateFriendsList();
            closeRequests();
        } else $(el).parents('.el').show();
    });
}

// Removes a friendship through socket.io, but by a request element.
function declineRequest(el) {
    const friendId = $(el).parents('.el').data('user-id');
    removeFriendship(friendId, el);
}

// Removes friendship through socket.io by friend's UID
// elToRemove is an optional argument containing the HTML element to remove after successful friendship removal.
function removeFriendship(friendUid, elToRemove) {
    if (elToRemove) $(elToRemove).parents('.el').hide();
    socket.emit('remove friend', friendUid, (result) => {
        if (result && elToRemove) {
            $(elToRemove).remove();
            updateFriendsList();
        } else $(elToRemove).parents('.el').show();
    });
}

function removeFriend(el) {
    const userId = $(el).parents('.el').data('friend-id');

    removeFriendship(userId, $(el).parents('.el'));
}

// Some functions
function toggleSocialTabMobile() {
    $('.social').toggleClass('active');
    closeCards();
}

// Helper function that physically opens the chat menu, should be called after downloading data.
const openMenu = () => {
    $('#chatbox').toggleClass('active');

    // Scroll to the bottom of the message history
    $('#chat').scrollTop($('#chat').get(0).scrollHeight);

    // We will animate only the last 15 messages to make the animation fully visible but quick and smooth.
    const elements = document.querySelectorAll('.chat .wrapper');
    const animationElements = Array.from(elements).slice(-15);

    // Animate messages appearing from the bottom (the most recent)
    anime({
        targets: animationElements,
        easing: 'easeOutExpo',
        translateY: [-50, 0],
        opacity: [0, 1],
        duration: 500,
        delay: anime.stagger(100, { direction: 'reverse', start: 300 })
    });
};

function tryLoadConversationFromCache(el) {
    const userId = $(el).parents('.el').data('friend-id');
    activeChatFriendId = userId;

    const nickname = ($(el).parents('.el').get(0)).querySelector('.friendNickname').innerHTML;
    $('#chatFriendName').html(nickname);

    if (conversationCache[userId]) {
        console.log('Loading message history from cache for conversation with user of UID:', userId);
        $('#chat').html(conversationCache[userId]);

        // Open the menu and animate stuff.
        openMenu();
        return true;
    }

    return false;
}

function openChat(el) {
    if (tryLoadConversationFromCache(el)) return;
    const userId = $(el).parents('.el').data('friend-id');

    console.log("Fetching conversation with user of UID:", userId);
    socket.emit('get conversation', userId, (messages) => {
        console.log("Conversation with user of UID fetched successfully:", userId);
        // Format messages' created_at date.
        messages = messages.map(msg => ({
            ...msg,
            created_at: new Date(msg.created_at)
        }));

        let finalHTML = `<div class="wrapper info">${window.locale['This is the beginning of your conversation']}<br>${window.locale['Chats are not supervised nor encrypted']}</div>`;
        // Add messages to the HTML
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            finalHTML += `<div class="wrapper"><p class="bubble ${msg.sender === userId ? 'incoming' : ''}">${msg.content}</p></div>`;
        }

        $('#chat').html(finalHTML);
        conversationCache[userId] = finalHTML;

        // Open the menu and animate stuff.
        openMenu();

        console.log("Conversation with user of UID fetched and processed successfully:", userId);
    });
}

function closeChat() {
    $('#chatbox').removeClass('active');
    activeChatFriendId = null;
}

function addMessage(userId, incoming, content) {
    const wrapper = document.createElement("div");
    wrapper.classList = 'wrapper';

    const bubble = document.createElement('p');
    bubble.classList = 'bubble' + (incoming ? ' incoming' : '');
    bubble.innerHTML = escapeHTML(content).replace(/(?:\r\n|\r|\n)/g, '<br>');
    wrapper.appendChild(bubble);

    document.getElementById('chat').appendChild(wrapper);

    // Animate message sliding in.
    anime({
        targets: wrapper,
        easing: 'easeOutQuint',
        translateX: [incoming ? -100 : 100, 0],
        opacity: [0, 1],
        duration: 500,
        delay: 200
    }).finished.then(() => {
        // Update the cache if it exists
        if (conversationCache[userId]) {
            conversationCache[userId] += wrapper.outerHTML;
        }
    });

    // Scroll to the bottom of the message history
    if ($('#chat').get(0).scrollHeight - $('#chat').scrollTop() > $('#chat').height()) smoothScrollToBottom(document.querySelector('#chat'), 300);
}

function smoothScrollToBottom(element, duration) {
    const start = element.scrollTop;
    const end = element.scrollHeight - $(element).height();
    const change = end - start;
    const startTime = performance.now();

    function scrollStep(currentTime) {
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1); // progress goes from 0 to 1
        const ease = easeInOutExpo(progress);

        element.scrollTop = start + change * ease;

        if (progress < 1) {
            requestAnimationFrame(scrollStep); // Keep going until progress hits 1
        }
    }

    requestAnimationFrame(scrollStep);
}

// Easing function for smoother scrolling
function easeInOutExpo(t) {
    return t === 0
        ? 0
        : t === 1
            ? 1
            : t < 0.5
                ? Math.pow(2, 20 * t - 10) / 2
                : (2 - Math.pow(2, -20 * t + 10)) / 2;
}

function sendSocialToast(category, header, content) {
    Toastify({
        text: `<h2>${category}</h2><h1>${header}</h1><p>${content}</p>`,
        escapeMarkup: false,
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
}

// Opens the friend requests card
function openRequests() {
    $('#requestsbox').toggleClass('active');
}

function closeRequests() {
    $('#requestsbox').removeClass('active');
}

// This function closes all cards, it is used when the Social tab collapses
function closeCards() {
    closeChat();
    closeRequests();
}
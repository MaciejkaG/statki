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
            targets: ['.social .expanded h1.mainTitle', '.social .expanded .inviteFriends', '.social .expanded .friendsList .el'],
            easing: 'easeOutQuint',
            translateX: [100, 0],
            opacity: [0, 1],
            duration: 500,
            delay: anime.stagger(150, { start: 200 })
        });
    }
}, function () {
    if (!$('.social *').is(":focus")) closeChat();
});

$('.social').on('focusout', function () {
    if (!$('.social').is(":focus") && !$('.social').is(":hover")) closeChat();
});

const messageBox = document.getElementById('messageBox');
messageBox.addEventListener('keydown', (e) => {
    // If Enter has been pressed without shift
    if (e.key === 'Enter' && !e.shiftKey) {
        // Prevent making an indent in the textarea.
        e.preventDefault();

        socket.emit('send message', activeChatFriendId, messageBox.value, () => {
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
function updateFriendsList() {
    console.log("Downloading friends list now...");
    socket.emit("my friends", (friendsList) => {
        console.log("Successfully received the friends list. Processing...");
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
        const friendsOnline = friendsList.filter(friend => friend.lastOnline && friend.lastOnline.secondsAgo < 6).length;
        // Show this count in the Social tab quick access.
        document.getElementById('friendsOnline').innerHTML = friendsOnline;

        // Sort friendsList by status: online > ingame > offline
        friendsList.sort((a, b) => {
            const getStatusPriority = (friend) => {
                if (!friend.lastOnline) return 3; // Offline
                if (friend.lastOnline.secondsAgo < 6) return 1; // Online
                if (friend.lastOnline.activity === 'playing') return 2; // Ingame
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

            // If the last online status is from less than 6 seconds ago, we assume the user is online
            if (lastOnline && lastOnline.secondsAgo < 6) {
                // We now determine whether they are playing or just online
                if (lastOnline.activity === 'playing') {
                    statusText = window.locale['In game'];
                    statusClass = 'ingame';
                } else {
                    statusText = window.locale['Online'];
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
                        <button class="danger">${window.locale['Remove friend']}</button>
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

        console.log("Successfully received and processed the friends list.");
    });
}

updateFriendsList();
setInterval(updateFriendsList, 3000);

socket.on('new message', (fromId, nickname, content) => {
    addMessage(fromId, true, content);
    if (fromId === activeChatFriendId) {
        sendSocialToast('New message', '', nickname + ' ' + window.locale['just sent you a message! You can read it in the Social tab']);
    }
});

// Some functions

function toggleSocialTabMobile() {
    $('.social').toggleClass('active');
    closeChat();
}

// Helper function that physically opens the chat menu, should be called after downloading data.
const openMenu = () => {
    $('.chatBox').toggleClass('active');

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

    console.log(conversationCache[userId]);
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

        let finalHTML = `<div class="wrapper info">${window.locale['This is the beginning of your conversation']}</div>`;
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
    $('.chatBox').removeClass('active');
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
        // Update the cache
        conversationCache[userId] += wrapper.outerHTML;
        console.log(conversationCache)
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
        duration: 7000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
}
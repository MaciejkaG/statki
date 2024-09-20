// Cycling the messages every 5 seconds
const generalQuery = '.social .collapsed span.el';

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

$('.social').hover(function() {
    if ($(window).width() > 820) {
        anime({
            targets: ['.social .expanded h1.mainTitle', '.social .expanded .inviteFriends', '.social .expanded .friendsList .el'],
            easing: 'easeOutQuint',
            translateX: [100, 0],
            opacity: [0, 1],
            duration: 500,
            delay: anime.stagger(150, { start: 200 })
        });
    }
}, function () { }); // It needs the second function not to glitch for some reason

const buttonsAnimation = {
    easing: 'easeOutExpo',
    translateY: [50, 0],
    opacity: [0, 1],
    duration: 500,
    delay: anime.stagger(100)
};

$('.friendsList .el').hover(function(e) {
    if ($(window).width() > 820) {
        anime({
            ...buttonsAnimation,
            targets: e.target.querySelectorAll('.buttons button')
        });
    }
}, function() {}); // Again, it needs the second function not to glitch for some reason

function toggleSocialTabMobile() {
    $('.social').toggleClass('active');
}

function openChat() {
    $('.chatBox').toggleClass('active');
}
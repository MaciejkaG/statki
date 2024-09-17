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
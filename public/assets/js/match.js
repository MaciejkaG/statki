const bsc = new Battleships(10);

let board = bsc.generateDOMBoard(10);
$("#board").html(board);
$("#secondaryBoard").html(board);

var lastStatSwitch = new Date().getTime();

function switchStats() {
    const toggle = document.getElementById('toggle');

    if (new Date().getTime() - lastStatSwitch < 400) {
        toggle.checked = !toggle.checked;
        return;
    }

    if (toggle.checked) { // Guest stats were selected
        $('#hostStats').css({
            'animation': 'HostStatsOutAnim 0.2s 1 ease',
            'display': 'none'
        });

        setTimeout(() => {
            $('#guestStats').css({
                'animation': 'GuestStatsInAnim 0.2s 1 ease',
                'display': 'flex'
            });
        }, 200);
    } else { // Host stats were selected
        $('#guestStats').css({
            'animation': 'GuestStatsOutAnim 0.2s 1 ease',
            'display': 'none'
        });

        setTimeout(() => {
            $('#hostStats').css({
                'animation': 'HostStatsInAnim 0.2s 1 ease',
                'display': 'flex'
            });
        }, 200);
    }

    lastStatSwitch = new Date().getTime();
}
const bsc = new Battleships(10);

let board = bsc.generateDOMBoard(10);
$("#board").html(board);
$("#secondaryBoard").html(board);

var lastStatSwitch = new Date().getTime();

let hostOccupiedFields = [];
let guestOccupiedFields = [];

window.addEventListener('load', () => {
    console.log(hostBoard);

    for (let i = 0; i < hostBoard.ships.length; i++) {
        const ship = hostBoard.ships[i];
        let shipFields = bsc.placeShip(ship);

        shipFields.forEach(field => {
            hostOccupiedFields.push(field);
        });

        if (!ship.hits.includes(false)) {
            shipFields.forEach(field => {
                bsc.setField(field[0], field[1], 'sunken')
            });
        }
    }

    for (let i = 0; i < guestBoard.ships.length; i++) {
        const ship = guestBoard.ships[i];
        let shipFields = bsc.placeShip(ship, true);

        shipFields.forEach(field => {
            guestOccupiedFields.push(field);
        });

        if (!ship.hits.includes(false)) {
            shipFields.forEach(field => {
                bsc.setFieldEnemy(field[0], field[1], 'sunken')
            });
        }
    }

    for (let i = 0; i < hostBoard.shots.length; i++) {
        const shot = hostBoard.shots[i];

        if (hostOccupiedFields.some(field => field[0] == shot.posX && field[1] == shot.posY)) { // Why does this always throw false even though e.g. [1, 1] exists in the hostOccupiedFields array
            bsc.setField(shot.posX, shot.posY, 'hit');
        } else {
            bsc.setField(shot.posX, shot.posY, 'miss');
        }
    }

    for (let i = 0; i < guestBoard.shots.length; i++) {
        const shot = guestBoard.shots[i];

        if (guestOccupiedFields.some(field => field[0] == shot.posX && field[1] == shot.posY)) { // Why does this always throw false even though e.g. [1, 1] exists in the hostOccupiedFields array
            bsc.setFieldEnemy(shot.posX, shot.posY, 'hit');
        } else {
            bsc.setFieldEnemy(shot.posX, shot.posY, 'miss');
        }
    }

    console.log(hostOccupiedFields)
});

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
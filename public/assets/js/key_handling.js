document.addEventListener("keydown", (e) => {
    switch (e.code) {
        case "KeyB":
            switchBoards();
            break;
        case "KeyS":
            switchShips();
            break;
        case "KeyR":
            switchRotation();
            break;
    }
});
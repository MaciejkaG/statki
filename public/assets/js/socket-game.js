const socket = io();

socket.on("players ready", () => {
    $(".cover").css({opacity: 0, pointerEvents: "none"});
    socket.emit("shoot");
});
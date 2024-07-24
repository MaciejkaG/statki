// Handling connection errors
socket.on("reconnecting", (number) => {
    Toastify({
        text: `${window.locale["Reconnecting"]} ${number}`,
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});

socket.on("reconnect", () => {
    Toastify({
        text: window.locale["Reconnected"],
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});

socket.on("reconnect_error", () => {
    Toastify({
        text: window.locale["Reconnection error occured"],
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});

socket.on("reconnect_failed", () => {
    Toastify({
        text: window.locale["Reconnection failed"],
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});

socket.on("disconnect", () => {
    Toastify({
        text: `${window.locale["Disconnected"]}\n${window.locale["Try to refresh the page if this error reoccurs"]}`,
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});

socket.on("error", () => {
    Toastify({
        text: window.locale["Connection error"],
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});
// Handling connection errors
socket.on("reconnecting", (number) => {
    Toastify({
        text: `Ponowne łączenie... ${number}`,
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
        text: "Połączono ponownie",
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
        text: "Wystąpił problem w trakcie ponownego łączenia",
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
        text: "Nie udało się połączyć ponownie",
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
        text: "Rozłączono z serwerem\nSpróbuj odświeżyć stronę jeżeli błąd będzie się powtarzał",
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
        text: "Błąd połączenia",
        duration: 5000,
        newWindow: true,
        gravity: "bottom",
        position: "right",
        stopOnFocus: true,
        className: "bshipstoast",
    }).showToast();
});
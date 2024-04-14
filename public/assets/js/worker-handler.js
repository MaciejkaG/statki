if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/assets/js/service-worker.js")
            .then(res => console.log("Service worker registered"))
            .catch(err => console.log("Service worker not registered", err));
    });
}
const statki = "statki-by-maciejka-0.10.1";
const assets = [
    "/favicon.ico",
    "/assets/css/landing.css",
    "/assets/css/main.css",
    "/assets/css/responsive.css",
    "/assets/css/match.css",
    "/assets/css/board.css",
    "/assets/css/board-responsive.css",
    "/assets/js/battleships-lib.js",
    "/assets/js/key-handling.js",
    "/assets/js/landing.js",
    "/assets/js/main.js",
    "/assets/js/socket-err-handler.js",
    "/assets/js/socket-game.js",
    "/assets/js/socket.js",
    "/assets/js/spa_lib.js",
    "/assets/img/check-circle.svg",
    "/assets/img/shopping-cart.svg"
];

self.addEventListener("install", installEvent => {
    installEvent.waitUntil(
        caches.open(statki).then(cache => {
            cache.addAll(assets);
        })
    );
});


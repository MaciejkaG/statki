String.prototype.replaceAt = function (index, replacement) {
    return this.substring(0, index) + replacement + this.substring(index + replacement.length);
}

const socket = io();

// Temporarily commented out, as it causes huge graphical glitches

// const charset = ["0", "1", "!", "@", "#", "$", "%", "&"];

// const initialContent = $("#scrolldowntext").html();

// setInterval(() => {
//     var content = $("#scrolldowntext").html();
//     const len = content.length;

//     for (let i = 0; i < len; i++) {
//         const duration = Math.random() * 20 + 40;

//         setTimeout(() => {
//             let previousChar = content.charAt(i);

//             let randomChar = charset[Math.floor(Math.random() * charset.length)];
//             content = content.replaceAt(i, randomChar);

//             $("#scrolldowntext").html(content);

//             setTimeout(() => {
//                 content = content.replaceAt(i, previousChar);
//                 $("#scrolldowntext").html(content);

//                 if (i == len - 1) {
//                     content = initialContent;
//                     $("#scrolldowntext").html(initialContent);
//                 }
//             }, duration * len + duration * i);
//         }, duration * i);
//     }
// }, 5000);

document.addEventListener("wheel", (event) => {
    if (event.deltaY > 0) {
        $(".loginContainer").addClass("active");
        animateShips();
    } else if (event.deltaY < 0) {
        $(".loginContainer").removeClass("active");
    }
});

let touchStart = 0;

window.addEventListener("touchstart", function (event) {
    touchStart = event.touches[0].clientY;
});

window.addEventListener("touchend", function (event) {
    touchEnd = event.changedTouches[0].clientY;

    if (touchStart - touchEnd > 50) {
        $(".loginContainer").addClass("active");
        animateShips();
    } else if (touchStart - touchEnd < -50) {
        $(".loginContainer").removeClass("active");
    }
});

function animateShips() {
    setTimeout(() => {
        for (let i = 1; i <= 10; i++) {
            setTimeout(() => {
                $(`#f${i}`).css("scale", "1");
            }, 100 * (i - 1));
        }
    }, 400);
    const fields = document.querySelectorAll(".field");
    fields.forEach(field => {
        if (!field.id) {
            $(field).css("scale", "1");
        }
    });
}

switchView("loginView");

const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();

    if (emailInput.value) {
        lockUI(true);
        console.log("Logging in with e-mail:", emailInput.value);
        socket.emit("email login", emailInput.value, (response) => {
            console.log(response);
            switch (response.status) {
                case "ok":
                    console.log("Logged in.");

                    console.log(response);

                    if (response.next === "done") {
                        console.log("No authorisation required.");
                        $("body").addClass("closed");

                        setTimeout(() => {
                            window.location.reload();
                        }, 700);
                        return;
                    }

                    lockUI(false);
                    switchView("authView");
                    progressParalax();
                    break;

                default:
                    Toastify({
                        text: response.error,
                        duration: 5000,
                        newWindow: true,
                        gravity: "bottom",
                        position: "right",
                        stopOnFocus: true,
                        className: "bshipstoast",
                    }).showToast();

                    lockUI(false);
                    break;
            }
        });

        emailInput.value = '';
    } else {
        Toastify({
            text: window.locale["E-mail address is required"],
            duration: 5000,
            newWindow: true,
            gravity: "bottom",
            position: "right",
            stopOnFocus: true,
            className: "bshipstoast",
        }).showToast();
    }
});

const authForm = document.getElementById('authForm');
const codeInput = document.getElementById('authcode');

authForm.addEventListener('submit', (e) => {
    e.preventDefault();

    if (codeInput.value) {
        lockUI(true);
        console.log("Logging in with e-mail:", codeInput.value);
        socket.emit("email auth", codeInput.value, (response) => {
            switch (response.status) {
                case "ok":
                    console.log("Authorised.");
                    lockUI(false);

                    $("body").addClass("closed");

                    setTimeout(() => {
                        window.location.reload();
                    }, 700);
                    break;

                default:
                    Toastify({
                        text: response.error,
                        duration: 5000,
                        newWindow: true,
                        gravity: "bottom",
                        position: "right",
                        stopOnFocus: true,
                        className: "bshipstoast",
                    }).showToast();

                    lockUI(false);
                    break;
            }
        });

        emailInput.value = '';
    } else {
        Toastify({
            text: window.locale["Auth code is required"],
            duration: 5000,
            newWindow: true,
            gravity: "bottom",
            position: "right",
            stopOnFocus: true,
            className: "bshipstoast",
        }).showToast();
    }
});

var parallaxTranslateX = 0;

function progressParalax() {
    parallaxTranslateX -= 30;
    $(".bgShip.big").css("translate", `${parallaxTranslateX}vw`);
    $(".bgShip.small").css("translate", `${parallaxTranslateX * 0.625}vw`);
}
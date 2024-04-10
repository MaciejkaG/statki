String.prototype.replaceAt = function (index, replacement) {
    return this.substring(0, index) + replacement + this.substring(index + replacement.length);
}

const charset = ["0", "1", "!", "@", "#", "$", "%", "&"];

setInterval(() => {
    var content = $("#scrolldowntext").html();
    const len = content.length;

    for (let i = 0; i < len; i++) {
        const duration = Math.random() * 20 + 40;

        setTimeout(() => {
            let previousChar = content.charAt(i);

            let randomChar = charset[Math.floor(Math.random() * charset.length)];
            content = content.replaceAt(i, randomChar);

            $("#scrolldowntext").html(content);

            setTimeout(() => {
                content = content.replaceAt(i, previousChar);
                $("#scrolldowntext").html(content);
            }, duration * len + duration * i);
        }, duration * i);
    }
}, 5000);

document.addEventListener("wheel", (event) => {
    if (event.deltaY > 0) {
        $(".loginContainer").addClass("active");
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
    } else if (event.deltaY < 0) {
        $(".loginContainer").removeClass("active");
    }
});

switchView("loginView");

const form = document.getElementById('loginForm');
form.addEventListener('submit', (e) => {
    e.preventDefault();

    console.log("a");
    switchView("authView");
    progressParalax();
});

var parallaxTranslateX = 0;

function progressParalax() {
    parallaxTranslateX -= 30;
    $(".bgShip.big").css("translate", `${parallaxTranslateX}vw`);
    $(".bgShip.small").css("translate", `${parallaxTranslateX * 0.625}vw`);
}
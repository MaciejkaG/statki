var activeView;
var returnLock = false;

function switchView(viewContainerId, useReplaceState=false) {
    if (!returnLock) {
        $(`.container`).css({ opacity: 0, animation: "OutAnim 0.2s 1 ease" });
        setTimeout(() => {
            $(`.container`).css("display", "none");
            $(`.container#${viewContainerId}`).css({ display: "flex", opacity: 1, animation: "InAnim 0.2s 1 ease" });
            let path = $(`.container#${viewContainerId}`).data("path");
            let title = $(`.container#${viewContainerId}`).data("title");
            if (useReplaceState) {
                history.replaceState(null, "", path ? path : "/");
            } else {
                history.pushState(null, title ? title : "Statki", path ? path : "/");
            }

            activeView = viewContainerId;
        }, 200);
    }
}

function lockUI(doLock) {
    if (doLock) {
        $("body").css("pointer-events", "none");
        $("body").css("opacity", "0.4");
    } else {
        $("body").css("pointer-events", "inherit");
        $("body").css("opacity", "1");
    }
}

const initialURLParams = new URLSearchParams(window.location.search);
const initialPath = initialURLParams.get('path');

window.addEventListener("load", () => {
    // if (initialPath != null) {
    //     let elem = document.querySelector(`.container[data-path="${initialPath}"]`);

    //     if (elem != null) {
    //         switchView(elem.id, true);
    //         activeView = elem.id;
    //     }
    // } else {
        switchView("mainMenuView");
        activeView = "mainMenuView";
    //}
});

addEventListener("popstate", (event) => {
    event.preventDefault();
    if (!returnLock) {
        let elem = document.querySelector(`.container[data-path="${window.location.pathname}"]`);
        if (elem != null) {
            switchView(elem.id, true);
        }
    }
});
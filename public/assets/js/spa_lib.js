var activeView;
var returnLock = false;

function switchView(viewContainerId, useReplaceState = false) {
    if (!returnLock && viewContainerId !== activeView) {
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

        // Create and dispatch an event on view switch
        const event = new CustomEvent('switchviews', {
            detail: { destination: viewContainerId }
        });
        document.dispatchEvent(event);
    }
}

function lockUI(doLock) {
    if (doLock) {
        $("body").css("pointer-events", "none");
        $(".container").css("opacity", "0.4");
    } else {
        $("body").css("pointer-events", "initial");
        $(".container").css("opacity", "1");
    }
}

const initialURLParams = new URLSearchParams(window.location.search);
const initialPath = initialURLParams.get('path');

window.addEventListener("load", () => {
    if (initialPath != null) {
        let elem = document.querySelector(`.container[data-path="${initialPath}"]:not(.container[data-pathlock])`);

        if (elem != null) {
            switchView(elem.id, true);
        }
    }
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
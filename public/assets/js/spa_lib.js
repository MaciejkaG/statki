var activeView;

function switchView(viewContainerId, useReplaceState=false) {
    $(`.container`).css("opacity", 0);
    setTimeout(() => {
        $(`.container`).css("display", "none");
        $(`.container#${viewContainerId}`).css({"display": "flex", "opacity": "1"});
        let path = $(`.container#${viewContainerId}`).data("path");
        let title = $(`.container#${viewContainerId}`).data("title");
        if (useReplaceState) {
            history.replaceState(null, "", path ? path : "/");
        } else {
            history.pushState(null, title ? title : "Statki", path ? path : "/");
        }

        activeView = viewContainerId;
    }, 150);
}

const initialURLParams = new URLSearchParams(window.location.search);
const initialPath = initialURLParams.get('path');

window.addEventListener("load", () => {
    if (initialPath != null) {
        let elem = document.querySelector(`.container[data-path="${initialPath}"]`);

        if (elem != null) {
            switchView(elem.id, true);
            activeView = elem.id;
            
        }
    } else {
        switchView("mainMenuView");
        activeView = "mainMenuView";
    }
});

addEventListener("popstate", (event) => {
    event.preventDefault();
    let elem = document.querySelector(`.container[data-path="${window.location.pathname}"]`);
    if (elem != null) {
        switchView(elem.id, true);
    }
});
class Battleships {
    constructor(boardSize) {
        if (boardSize>0) {
            this.boardSize = boardSize;
        } else {
            throw new Error("Incorrect boardSize for the 'Battleships' class");
        }
    }

    generateDOMBoard(size) {
        let board = "";
        for (var i = 0; i < size; i++) {
            let row = "<div class=\"row\">";
            for (var n = 0; n < size; n++) {
                row += `<div class="field" data-pos-x="${n}" data-pos-y="${i}"><div class="shipField"><svg xmlns='http://www.w3.org/2000/svg' version='1.1' preserveAspectRatio='none' viewBox='0 0 100 100'><path d='M100 0 L0 100 ' stroke='#ffffff' stroke-width='10'/><path d='M0 0 L100 100 ' stroke='#ffffff' stroke-width='10'/></svg></div></div>`;
            }
            row += "</div>";
            board += row;
        }

        return board;
    }

    getField(x, y) {
        if (0 <= x && x < this.boardSize && 0 <= y && y <= this.boardSize) {
            return $(`#board .row:nth-child(${y + 1}) .field:nth-child(${x + 1})`);
        } else {
            throw new RangeError("getField position out of range.");
        }
    }

    getFieldSecondary(x, y) {
        if (0 <= x && x < this.boardSize && 0 <= y && y < this.boardSize) {
            return $(`#secondaryBoard .row:nth-child(${y + 1}) .field:nth-child(${x + 1})`);
        } else {
            throw new RangeError("getField position out of range.");
        }
    }

    getRow(row) {
        if (row < this.boardSize) {
            return $(`.board .row:nth-child(${row + 1}) .field`);
        } else {
            throw new RangeError("getRow position out of range.");
        }
    }

    getColumn(column) {
        if (column < this.boardSize) {
            return $(`.board .row .field:nth-child(${column + 1})`);
        } else {
            throw new RangeError("getColumn position out of range.");
        }
    }

    setField(x, y, state) {
        if (state==="hit") {
            this.getField(x, y).children().children("svg").html("<path d='M100 0 L0 100 ' stroke='#ffffff' stroke-width='10'/><path d='M0 0 L100 100 ' stroke='#ffffff' stroke-width='10'/>");
            this.getField(x, y).addClass("hit");
        } else if (state==="miss") {
            this.getField(x, y).children(".shipField").css("background-color", "var(--ship-miss)");
            this.getField(x, y).addClass("active hit");
            this.getField(x, y).children().children("svg").html("<circle fill='#ffffff' cx='50' cy='50' r='20' />");
        } else if (state === "sunken") {
            this.getField(x, y).addClass("sunken");
        }
    }

    setFieldEnemy(x, y, state) {
        if (state === "hit") {
            this.getFieldSecondary(x, y).children().children("svg").html("<path d='M100 0 L0 100 ' stroke='#ffffff' stroke-width='10'/><path d='M0 0 L100 100 ' stroke='#ffffff' stroke-width='10'/>");
            this.getFieldSecondary(x, y).addClass("active hit");
        } else if (state === "miss") {
            this.getFieldSecondary(x, y).children(".shipField").css("background-color", "var(--ship-miss)");
            this.getFieldSecondary(x, y).addClass("active hit");
            this.getFieldSecondary(x, y).children().children("svg").html("<circle fill='#ffffff' cx='50' cy='50' r='20' />");
        } else if (state === "sunken") {
            this.getFieldSecondary(x, y).addClass("sunken");
        }
    }

    placeShip(data, secondary = false) {
        let fields = [];
        switch (data.rot) {
            case 0:
                for (let i = 0; i <= data.type; i++) {
                    fields.push([data.posX + i, data.posY]);
                }
                break;
            case 1:
                for (let i = 0; i <= data.type; i++) {
                    fields.push([data.posX, data.posY + i]);
                }
                break;
            case 2:
                for (let i = 0; i <= data.type; i++) {
                    fields.push([data.posX - i, data.posY]);
                }
                break;
            case 3:
                for (let i = 0; i <= data.type; i++) {
                    fields.push([data.posX, data.posY - i]);
                }
                break;
        }

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            setTimeout(() => {
                if (secondary) {
                    this.getFieldSecondary(field[0], field[1]).addClass("active");
                } else {
                    this.getField(field[0], field[1]).addClass("active");
                }
            }, i * 150);
        }

        return fields;
    }
}
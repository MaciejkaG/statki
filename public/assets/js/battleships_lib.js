class Battleships {
    constructor(boardSize) {
        if (boardSize>0) {
            this.boardSize = boardSize;
        } else {
            throw new Error("Wrong boardSize for the 'Battleships' class");
        }
    }

    generateDOMBoard(size) {
        let board = "";
        for (var i = 0; i < size; i++) {
            let row = "<div class=\"row\">";
            for (var n = 0; n < size; n++) {
                row += `<div class="field" data-pos-x="${i}" data-pos-y="${n}"><svg xmlns='http://www.w3.org/2000/svg' version='1.1' preserveAspectRatio='none' viewBox='0 0 100 100'><path d='M100 0 L0 100 ' stroke='black' stroke-width='3'/><path d='M0 0 L100 100 ' stroke='black' stroke-width='3'/></svg></div>`;
            }
            row += "</div>";
            board += row;
        }

        return board;
    }

    getField(x, y) {
        if (0 < x && x <= this.boardSize && 0 < y && y <= this.boardSize) {
            return $(`#board .row:nth-child(${y}) .field:nth-child(${x})`);
        } else {
            throw new RangeError("getField position out of range.");
        }
    }

    getRow(row) {
        row = parseInt(row)+1
        if (row<=this.boardSize) {
            return $(`#board .row:nth-child(${row}) .field`);
        } else {
            throw new RangeError("getColumn position out of range.");
        }
    }

    getColumn(column) {
        column = parseInt(column)+1
        if (column<=this.boardSize) {
            return $(`#board .row .field:nth-child(${column})`);
        } else {
            throw new RangeError("getColumn position out of range.");
        }
    }
}
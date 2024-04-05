import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Lang {
    constructor(langs) {
        const languagesPath = path.join(__dirname, '../lang');
        this.allText = null;
        for (let i = 0; i < langs.length; i++) {
            const lang = langs[i];

            if (fs.readdirSync(languagesPath).includes(`${lang}.json`)) {
                try {
                    this.allText = JSON.parse(fs.readFileSync(path.join(languagesPath, `${lang}.json`), 'utf8'));
                    this.lang = lang;
                    return;
                } catch (e) {
                    console.log(e);
                }
            }
        }

        this.allText = JSON.parse(fs.readFileSync(path.join(languagesPath, 'en.json'), 'utf8'));
        this.lang = 'en';
    }

    t(key) {
        if (this.allText == null) {
            throw new Error(`Language class has been improperly configured. (Unknown localisation module error)`);
        } else {
            let keySplit = key.split(".");

            try {
                return keySplit.reduce((x, y) => x[y], this.allText);
            } catch (e) {
                if (e instanceof TypeError) {
                    return "LocKeyErr"
                }
            }
        }
    }


}


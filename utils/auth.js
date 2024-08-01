import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import geoip from 'geoip-lite';

import mysql from 'mysql';
import { Lang } from './localisation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MailAuth {
    constructor(redis, options, mysqlOptions) {
        this.redis = redis;
        mysqlOptions.multipleStatements = true;
        this.mysqlOptions = mysqlOptions;

        this.mail = nodemailer.createTransport({
            host: options.host ? options.host : "localhost",
            port: options.port ? options.port : "465",
            secure: options.secure ? options.secure : true,
            auth: {
                user: options.user,
                pass: options.pass,
            },
        });

        this.mailFrom = `"Statki" <${options.user}>`
    }

    async timer(tId, time, callback) {
        let timerEnd = new Date().getTime() / 1000 + time;

        await this.redis.set(`loginTimer:${tId}`, timerEnd);

        let interval = setInterval(async () => {
            if (new Date().getTime() < timerEnd) {
                clearInterval(interval);
                
                callback();
                return;
            }

            let lastUpdate = await this.redis.get(`loginTimer:${tId}`);
            if (timerEnd != lastUpdate) {
                clearInterval(interval);
                return;
            }
        }, 1000);

        // let timeout = setTimeout(callback, time * 1000);

        // let interval = setInterval(async () => {
        //     if (timeout._destroyed) {
        //         clearInterval(interval);
        //         return;
        //     }

        //     let lastUpdate = await this.redis.get(`loginTimer:${tId}`);
        //     if (localLastUpdate != lastUpdate) {
        //         clearTimeout(timeout);
        //         clearInterval(interval);
        //         return;
        //     }
        // }, 200);
    }

    async resetTimer(tId) {
        let lastUpdate = await this.redis.get(`loginTimer:${tId}`);
        await this.redis.set(`loginTimer:${tId}`, -lastUpdate);
    }

    loginAuthless(email) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)};`, async (error, response) => {
                if (error) { reject(error); return; }

                if (response.length === 0 || response[0].nickname == null) {
                    if (response.length === 0) {
                        conn.query(`INSERT INTO accounts(email) VALUES (${conn.escape(email)});`, (error) => { if (error) reject(error) });
                    }

                    conn.query(`SELECT user_id FROM accounts WHERE email = ${conn.escape(email)};`, async (error, response) => {
                        if (error) reject(error);
                        const row = response[0];

                        conn.end();
                        resolve({ status: 1, uid: row.user_id });
                    });

                    return;
                }

                const row = response[0];

                conn.end();
                resolve({ status: 1, uid: row.user_id });
            });
        });
    }

    getLanguage(userId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`SELECT language FROM accounts WHERE user_id = ${conn.escape(userId)};`, (error, response) => {
                if (error) { reject(error); return; }

                if (response.length !== 0) {
                    resolve(response[0].language);
                } else {
                    resolve(null);
                }

                conn.end();
            });
        });
    }

    startVerification(email, ip, agent, langId, timeoutCallback = () => {}) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const lang = new Lang([langId]);

            conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)};`, async (error, response) => {
                if (error) { reject(error); conn.end(); return; }
                if (response.length !== 0) {
                    let timer = await this.redis.get(`loginTimer:${response[0].user_id}`);
                    if (timer && timer > 0) {
                        conn.end();
                        resolve({ status: -1, uid: response[0].user_id, });
                        return;
                    }
                }

                if (response.length === 0 || response[0].nickname == null) {
                    if (response.length === 0) {
                        conn.query(`INSERT INTO accounts(email) VALUES (${conn.escape(email)});`, (error) => { if (error) reject(error) });
                    }

                    conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)};`, async (error, response) => {
                        if (error) reject(error);
                        const row = response[0];

                        const html = fs.readFileSync(path.join(__dirname, `mail/auth-code-firsttime-${langId}.html`), 'utf8');
                        let authCode = genCode();

                        await this.redis.set(`codeAuth:${authCode}`, row.user_id);

                        // This timer executes a function if it ends a countdown.
                        // In this case it will destroy the user session and reset the log in process
                        await this.timer(row.user_id, 600, async () => {
                            await this.redis.unlink(`codeAuth:${authCode}`);
                            timeoutCallback();
                        });

                        authCode = authCode.slice(0, 4) + " " + authCode.slice(4);

                        const lookup = geoip.lookup(ip);

                        var lookupData;
                        if (lookup) {
                            lookupData = `User-Agent: ${agent}\nAdres IP: ${ip}\nKraj: ${lookup.country}\nRegion: ${lookup.region}\nMiasto: ${lookup.city}`;
                        } else {
                            lookupData = `IP lookup failed`;
                        }

                        try {
                            await this.mail.sendMail({
                                from: this.mailFrom,
                                to: email,
                                subject: lang.t('email.This is your Statki authorisation code').replace("%s", authCode),
                                html: html.replace("{{ CODE }}", authCode).replace("{{ LOOKUP }}", lookupData),
                            });
                        } catch (e) {
                            reject(e);
                        }

                        conn.end();
                        resolve({ status: 1, uid: row.user_id, code: authCode });
                    });

                    return;
                }

                const row = response[0];

                const html = fs.readFileSync(path.join(__dirname, `mail/auth-code-${langId}.html`), 'utf8');
                let authCode = genCode();

                await this.redis.set(`codeAuth:${authCode}`, row.user_id);

                await this.timer(row.user_id, 600, async () => {
                    await this.redis.unlink(`codeAuth:${authCode}`);
                });

                authCode = authCode.slice(0, 4) + " " + authCode.slice(4);

                const lookup = geoip.lookup(ip);

                var lookupData;
                if (lookup) {
                    lookupData = `User-Agent: ${agent}\nAdres IP: ${ip}\nKraj: ${lookup.country}\nRegion: ${lookup.region}\nMiasto: ${lookup.city}`;
                } else {
                    lookupData = `IP lookup failed`;
                }

                try {
                    await this.mail.sendMail({
                        from: this.mailFrom,
                        to: email,
                        subject: lang.t('email.This is your Statki authorisation code').replace("%s", authCode),
                        html: html.replace("{{ NICKNAME }}", row.nickname).replace("{{ CODE }}", authCode).replace("{{ LOOKUP }}", lookupData),
                    });
                } catch (e) {
                    reject(e);
                }
                

                conn.end();
                resolve({ status: 1, uid: row.user_id });
            });
        });
    }

    async finishVerification(uid, authCode) {
        authCode = authCode.replace(/\s+/g, "");
        const rUid = await this.redis.get(`codeAuth:${authCode}`);
        if (rUid != null && rUid === uid) {
            this.resetTimer(rUid);
            await this.redis.unlink(`codeAuth:${authCode}`);
            return true;
        } else {
            return false;
        }
    }

    saveMatch(matchId, duration, type, hostId, guestId, boards, winnerIdx, aitype = null, xp = null) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`INSERT INTO matches(match_id, match_type, host_id, guest_id, duration${aitype == null ? "" : ", ai_type"}${xp == null ? "" : ", xp"}) VALUES (${conn.escape(matchId)}, ${conn.escape(type)}, ${conn.escape(hostId)}, ${conn.escape(guestId)}, ${conn.escape(duration)}${aitype == null ? "" : ", " + conn.escape(aitype)}${xp == null ? "" : ", " + conn.escape(xp)})`, async (error) => {
                if (error) reject(error);
                else conn.query(`INSERT INTO statistics(match_id, user_id, board, won) VALUES (${conn.escape(matchId)}, ${conn.escape(hostId)}, ${conn.escape(JSON.stringify(boards[0]))}, ${conn.escape(winnerIdx ? 1 : 0)}), (${conn.escape(matchId)}, ${conn.escape(guestId)}, ${conn.escape(JSON.stringify(boards[1]))}, ${conn.escape(winnerIdx ? 0 : 1)})`, async (error, response) => {
                    if (error) reject(error);
                    else resolve();
                });

                conn.end();
            });
        });
    }

    getProfile(userId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT a.nickname, a.viewed_news, a.xp, a.level, CASE WHEN xp_boost_until > NOW() THEN 1 ELSE 0 END AS xp_boost_active, a.masts, a.account_creation, s.item_data FROM accounts a LEFT JOIN shop s ON s.item_id = a.active_name_style_item_id WHERE user_id = ?;
            SELECT ROUND((AVG(s.won)) * 100) AS winrate, COUNT(s.match_id) AS alltime_matches, COUNT(CASE WHEN (YEAR(m.date) = YEAR(NOW()) AND MONTH(m.date) = MONTH(NOW())) THEN m.match_id END) AS monthly_matches FROM accounts a JOIN statistics s ON s.user_id = a.user_id JOIN matches m ON m.match_id = s.match_id WHERE a.user_id = ?;
            SELECT statistics.match_id, accounts.nickname AS opponent, shop.item_data AS opponent_name_style, matches.match_type, statistics.won, matches.ai_type, matches.xp, matches.duration, matches.date FROM statistics JOIN matches ON matches.match_id = statistics.match_id JOIN accounts ON accounts.user_id = (CASE WHEN matches.host_id != statistics.user_id THEN matches.host_id ELSE matches.guest_id END) LEFT JOIN shop ON accounts.active_name_style_item_id = shop.item_id WHERE statistics.user_id = ? ORDER BY matches.date DESC LIMIT 10;
            `;
            conn.query(query, [userId, userId, userId], async (error, response) => {
                if (error) reject(error);
                else {
                    if (response[0].length === 0 || response[1].length === 0) {
                        reject(0);
                        return;
                    }

                    let [[profile], [stats], matchHistory] = response;

                    matchHistory = matchHistory.map(match => ({
                        ...match,
                        opponent_name_style: match.opponent_name_style ? JSON.parse(match.opponent_name_style).nameStyle : null
                    }));

                    profile.levelProgress = Math.floor(profile.xp / getXPForLevel(profile.level + 1) * 100);
                    profile.levelThreshold = getXPForLevel(profile.level + 1);
                    profile.nameStyle = profile.item_data ? JSON.parse(profile.item_data).nameStyle : null;
                    delete profile.item_data;

                    resolve({ profile, stats, matchHistory });
                }

                conn.end();
            });
        });
    }

    getMatchList(userId, page) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const limit = 10;
            const offset = (page - 1) * limit;

            const query = `
            SELECT 
                statistics.match_id, 
                accounts.nickname AS opponent, 
                shop.item_data AS opponent_name_style, 
                matches.match_type, 
                statistics.won, 
                matches.ai_type, 
                matches.xp, 
                matches.duration, 
                matches.date 
            FROM statistics 
            JOIN matches ON matches.match_id = statistics.match_id 
            JOIN accounts ON accounts.user_id = 
                (CASE 
                    WHEN matches.host_id != statistics.user_id THEN matches.host_id 
                    ELSE matches.guest_id 
                END) 
            LEFT JOIN shop ON accounts.active_name_style_item_id = shop.item_id
            WHERE statistics.user_id = ? 
            ORDER BY matches.date DESC 
            LIMIT ? OFFSET ?;
        `;

            conn.query(query, [userId, limit, offset], (error, response) => {
                if (error) {
                    reject(error);
                } else {
                    response = response.map(match => ({
                        ...match,
                        opponent_name_style: match.opponent_name_style ? JSON.parse(match.opponent_name_style).nameStyle : null
                    }));

                    resolve(response);
                }
                conn.end();
            });
        });
    }

    getShop() {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `SELECT item_id, name, description, category, price, item_data FROM shop WHERE hidden = 0 ORDER BY price DESC;`;
            conn.query(query, async (error, response) => {
                if (error) reject(error);
                else {
                    if (response[0].length === 0) {
                        reject(0);
                        return;
                    }

                    const items = response.map(item => ({
                        ...item,
                        item_data: JSON.parse(item.item_data)
                    }));

                    resolve(items);
                }

                conn.end();
            });
        });
    }

    buyItem(userId, itemId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT masts FROM accounts WHERE user_id = ?;
            SELECT price, limit_to_one FROM shop WHERE hidden = 0 AND item_id = ?;
            SELECT item_id FROM inventory WHERE user_id = ? AND item_id = ?;
            `;
            conn.query(query, [userId, itemId, userId, itemId], async (error, response) => {
                if (error) reject(error);
                else {
                    if ((response[0].length === 0 || response[1].length === 0) || (response[1][0].limit_to_one === 1 && response[2].length > 0)) {
                        resolve(false);
                        return;
                    }

                    let [[{ masts }], [{ price }]] = response;

                    if (masts < price) {
                        resolve(false);
                        return;
                    }

                    conn.query('INSERT INTO inventory(item_id, user_id) VALUES (?, ?);UPDATE accounts SET masts = masts - ? WHERE user_id = ?;', [itemId, userId, price, userId], async(error) => {
                        if (error) reject(error);
                        else resolve(true);
                    });
                }

                conn.end();
            });
        });
    }

    getInventory(userId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT i.inventory_item_id, i.item_id, s.name, s.description, s.category, s.item_data FROM inventory i JOIN shop s ON i.item_id = s.item_id WHERE i.user_id = ? ORDER BY s.category ASC, s.name ASC, i.obtainment_date DESC;
            `;
            conn.query(query, [userId], async (error, response) => {
                if (error) reject(error);
                else {
                    const items = response.map(item => ({
                        ...item,
                        item_data: JSON.parse(item.item_data)
                    }));

                    resolve(items);
                };

                conn.end();
            });
        });
    }

    getTheme(userId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT a.active_theme_item_id, s.item_data FROM accounts a JOIN shop s ON a.active_theme_item_id = s.item_id WHERE user_id = ?;
            `;
            conn.query(query, [userId], async (error, response) => {
                if (error) reject(error);
                else if (response[0]) resolve(JSON.parse(response[0].item_data).background);
                else resolve(null);

                conn.end();
            });
        });
    }

    setTheme(userId, themeItemId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);

            if (themeItemId === null) {
                conn.query('UPDATE accounts SET active_theme_item_id = ? WHERE user_id = ?;', [null, userId], async (error) => {
                    if (error) reject(error);
                    else {
                        conn.end();
                        resolve(null);
                    }
                });

                return;
            }

            const query = `
            SELECT category, item_data FROM shop WHERE item_id = ?;
            `;
            conn.query(query, [themeItemId], async (error, response) => {
                if (error) reject(error);
                else if (response[0].category === 'theme_pack') {
                    conn.query('UPDATE accounts SET active_theme_item_id = ? WHERE user_id = ?;', [themeItemId, userId], async (error) => {
                        if (error) reject(error);
                        else {
                            conn.end();
                            resolve(JSON.parse(response[0].item_data).background);
                        }
                    });
                } else {
                    conn.end();
                    resolve(false);
                }
            });
        });
    }

    setNameStyle(userId, nameStyleId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);

            if (nameStyleId === null) {
                conn.query('UPDATE accounts SET active_name_style_item_id = ? WHERE user_id = ?;', [null, userId], async (error) => {
                    if (error) reject(error);
                    else {
                        conn.end();
                        resolve(true);
                    }
                });

                return;
            }

            const query = `
            SELECT category FROM shop WHERE category = 'name_style' AND item_id = ?;
            `;
            conn.query(query, [nameStyleId], async (error, response) => {
                if (error) reject(error);
                else if (response.length !== 0) {
                    conn.query('UPDATE accounts SET active_name_style_item_id = ? WHERE user_id = ?;', [nameStyleId, userId], async (error) => {
                        if (error) reject(error);
                        else {
                            conn.end();
                            resolve(true);
                        }
                    });
                } else {
                    conn.end();
                    resolve(false);
                }
            });
        });
    }

    getNameStyle(userId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT a.active_name_style_item_id, s.item_data FROM accounts a JOIN shop s ON a.active_name_style_item_id = s.item_id WHERE user_id = ?;
            `;
            conn.query(query, [userId], async (error, response) => {
                if (error) reject(error);
                else if (response[0]) resolve(JSON.parse(response[0].item_data).nameStyle);
                else resolve(null);

                conn.end();
            });
        });
    }

    openLootbox(userId, lootboxId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);

            let query = `
            SELECT s.category FROM inventory i JOIN shop s ON i.item_id = s.item_id WHERE i.inventory_item_id = ? AND s.category = 'lootbox';
            SELECT s.item_id, name, description, category, item_data FROM shop s LEFT JOIN inventory i ON s.item_id = i.item_id AND i.user_id = ? WHERE (i.item_id IS NULL OR s.limit_to_one = 0) AND s.lootbox_droppable = 1 ORDER BY UUID();
            `;
            conn.query(query, [lootboxId, userId], async (error, response) => {
                if (error) reject(error);
                else if (response[0].length > 0) {
                    shuffle(response[1]);

                    const getDrop = () => {
                        const randomNumber = Math.random();

                        let nameStyleIndex = response[1].findIndex(item => item.category === 'name_style');
                        let themeIndex = response[1].findIndex(item => item.category === 'theme_pack');

                        if (randomNumber < 0.1 && nameStyleIndex !== -1) {
                            return nameStyleIndex;
                        } else if (randomNumber < 0.2 && themeIndex !== -1) {
                            return themeIndex;
                        } else {
                            return response[1].findIndex(item => item.category === 'xp_boost');
                        }
                    }

                    query = `
                    DELETE FROM inventory WHERE inventory_item_id = ?;
                    INSERT INTO inventory(item_id, user_id) VALUES (?, ?);
                    `;

                    const drop = getDrop();

                    conn.query(query, [lootboxId, response[1][drop].item_id, userId], async (error) => {
                        if (error) reject(error);
                        else {
                            conn.end();

                            delete response[1][drop].item_id;
                            resolve({ ...response[1][drop], item_data: JSON.parse(response[1][drop].item_data) });
                        }
                    });
                } else {
                    conn.end();
                    resolve(false);
                }
            });
        });
    }

    useXPBoost(userId, itemId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);

            let query = `
            SELECT s.category, s.item_data FROM inventory i JOIN shop s ON i.item_id = s.item_id WHERE i.inventory_item_id = ? AND s.category = 'xp_boost';
            SELECT CASE WHEN xp_boost_until < NOW() THEN NULL ELSE xp_boost_until END xp_boost_until FROM accounts WHERE user_id = ?;
            `;
            conn.query(query, [itemId, userId], async (error, response) => {
                if (error) reject(error);
                else if (response[0].length > 0 && response[1].length > 0 && !response[1][0].xp_boost_until) {
                    let interval;
                    let itemData;

                    try {
                        itemData = JSON.parse(response[0][0].item_data);

                        if (itemData.boostInterval) interval = itemData.boostInterval;
                        else {
                            resolve(false);
                            return;
                        }
                    } catch (err) {
                        resolve(false);
                        return;
                    }
                    
                    query = `
                    DELETE FROM inventory WHERE inventory_item_id = ?;
                    UPDATE accounts SET xp_boost_until = DATE_ADD(NOW(), INTERVAL ${interval}) WHERE user_id = ?;
                    `

                    conn.query(query, [itemId, userId], async (error) => {
                        if (error) reject(error);
                        else {
                            conn.end();
                            
                            resolve(true);
                        }
                    });
                } else {
                    conn.end();
                    resolve(false);
                }
            });
        });
    }

    getMatch(matchId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT m.match_type, m.host_id, m.guest_id, m.ai_type, m.duration, m.date,
                   h.nickname AS host_username, g.nickname AS guest_username
            FROM matches m
            LEFT JOIN accounts h ON m.host_id = h.user_id
            LEFT JOIN accounts g ON m.guest_id = g.user_id
            WHERE m.match_id = ?;
            
            SELECT s.board, s.won 
            FROM statistics s
            WHERE s.match_id = ? 
            AND s.user_id = (SELECT m.host_id FROM matches m WHERE m.match_id = ?);
            
            SELECT s.board, s.won 
            FROM statistics s
            WHERE s.match_id = ? 
            AND s.user_id = (SELECT m.guest_id FROM matches m WHERE m.match_id = ?);
        `;
            conn.query(query, [matchId, matchId, matchId, matchId, matchId], (error, response) => {
                if (error) reject(error);
                else {
                    const [[matchInfo], [{ board: hostStats, won: hostWon }], [{ board: guestStats, won: guestWon }]] = response;

                    resolve({
                        match_info: {
                            ...matchInfo,
                            host_username: matchInfo.host_username,
                            guest_username: matchInfo.guest_username
                        },
                        host_stats: {...JSON.parse(hostStats), won: hostWon == 1 ? true : false},
                        guest_stats: {...JSON.parse(guestStats), won: guestWon == 1 ? true : false}
                    });
                }
                conn.end();
            });
        });
    }

    setNickname(uid, nickname) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`UPDATE accounts SET nickname = ${conn.escape(nickname)} WHERE user_id = ${conn.escape(uid)};`, (error) => {
                if (error) reject(error);
                resolve();

                conn.end();
            });
        });
    }

    setViewedNews(uid) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`UPDATE accounts SET viewed_news = 1 WHERE user_id = ${conn.escape(uid)};`, (error) => {
                if (error) reject(error);
                resolve();

                conn.end();
            });
        });
    }

    getNickname(uid) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`SELECT nickname FROM accounts WHERE user_id = ${conn.escape(uid)};`, (error, response) => {
                if (error) reject(error);
                resolve(response[0].nickname);
            });

            conn.end();
        });
    }

    addXP(userId, amount) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query('SELECT xp, level, CASE WHEN xp_boost_until > NOW() THEN 1 ELSE 0 END AS xp_boost_active FROM accounts WHERE user_id = ?;', [userId], (err, results) => {
                amount = Math.floor(amount);

                if (err) return reject(err);
                if (results.length === 0) return reject('Player not found');

                let { xp, level, xp_boost_active } = results[0];

                if (xp_boost_active) {
                    console.log('a');
                    amount *= 2;
                }

                xp += amount;

                let nextLevelXP = getXPForLevel(level + 1);
                let mastsEarned = 0;

                while (xp >= nextLevelXP) {
                    level++;
                    xp -= nextLevelXP;
                    nextLevelXP = getXPForLevel(level + 1);

                    // Levelup rewards in masts (ingame currency)
                    if (level % 50 === 0)      mastsEarned += 5000;
                    else if (level % 10 === 0) mastsEarned += 2000;
                    else                       mastsEarned += 500;
                }

                conn.query('UPDATE accounts SET xp = ?, level = ?, masts = masts + ? WHERE user_id = ?;', [xp, level, mastsEarned, userId], (err, results) => {
                    if (err) return reject(err);
                    resolve(amount);
                });
            });
        });
    }
}

function genCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function getXPForLevel(level) {
    return 500 + 11 * (level - 1);
}

function shuffle(array) {
    let currentIndex = array.length;

    while (currentIndex != 0) {
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }
}
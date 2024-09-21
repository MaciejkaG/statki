// Don't get deceived by the name of this file, it actually contains most of the MySQL connecting stuff, like managing account data..

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

        this.mailFrom = `"Statki" <${options.user}>`;
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
            SELECT a.nickname, a.viewed_news, a.xp, a.level, (CASE WHEN a.xp_boost_until > CURRENT_TIMESTAMP() THEN a.xp_boost_until ELSE NULL END) AS xp_boost_until, a.masts, a.account_creation, s.item_data FROM accounts a LEFT JOIN shop s ON s.item_id = a.active_name_style_item_id WHERE user_id = ?;
            SELECT ROUND((AVG(CASE WHEN (YEAR(m.date) = YEAR(NOW()) AND MONTH(m.date) = MONTH(NOW())) THEN s.won END)) * 100) AS winrate_month, COUNT(s.match_id) AS alltime_matches, COUNT(CASE WHEN (YEAR(m.date) = YEAR(NOW()) AND MONTH(m.date) = MONTH(NOW())) THEN m.match_id END) AS monthly_matches FROM accounts a JOIN statistics s ON s.user_id = a.user_id JOIN matches m ON m.match_id = s.match_id WHERE a.user_id = ?;
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

    getFriends(userId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            // Getting actual friends
            const query = `
            SELECT (CASE WHEN user1 = ? THEN user2 ELSE user1 END) AS friend_id, a.nickname FROM friendships f JOIN accounts a ON (CASE WHEN f.user1 = ? THEN f.user2 ELSE user1 END) = a.user_id WHERE active = 1 AND (user1 = ? OR user2 = ?);
            `;
            conn.query(query, [userId, userId, userId, userId], async (error, response) => {
                if (error) reject(error);
                else {
                    const friends = await Promise.all(
                        response.map(async friendship => ({
                            ...friendship,
                            lastOnline: await this.getLastOnline(friendship.friend_id)
                        }))
                    );

                    // Getting incoming friend requests
                    conn.query(`
                        SELECT (CASE WHEN user1 = ? THEN user2 ELSE user1 END) AS user_id, a.nickname, (CASE WHEN user1 = ? THEN 0 ELSE 1 END) AS incoming FROM friendships f JOIN accounts a ON (CASE WHEN f.user1 = ? THEN f.user2 ELSE user1 END) = a.user_id WHERE active = 0 AND (user1 = ? OR user2 = ?) ORDER BY incoming DESC;
                    `, [userId, userId, userId, userId, userId], async (error, requests) => {
                        if (error) reject(error);
                        else {
                            resolve({ friends, requests })
                        }

                        conn.end();
                    });
                }
            });
        });
    }

    async getLastOnline(userId) {
        // lastOnline contains a UTC timestamp in seconds of the last time the user was seen online.
        const lastOnline = await this.redis.json.get(`lastOnline:${userId}`);

        if (!lastOnline) {
            return null;
        }

        const currentTime = Math.floor(new Date().getTime() / 1000); // Current time in seconds (UTC)
        const secondsAgo = currentTime - lastOnline.timestamp; // How many seconds ago the user was last online

        return { secondsAgo, activity: lastOnline.activity };
    }

    // This function updates user's online status.
    async updateLastOnline(userId, activity) {
        await this.redis.json.set(`lastOnline:${userId}`, '$', { timestamp: Math.floor(new Date().getTime() / 1000), activity });
    }

    getConversation(userId, friendId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`
                SELECT friendship_id FROM friendships WHERE active = 1 AND (user1 = ? AND user2 = ?) OR (user2 = ? AND user1 = ?);
            `, [userId, friendId, userId, friendId], async (error, [response]) => {
                if (error) reject(error);
                else {
                    if (response === undefined) {
                        resolve(null);
                        return;
                    }

                    const friendshipId = response.friendship_id;
                    conn.query(`
                        SELECT sender, content, created_at FROM messages WHERE friendship_id = ? AND (sender = ? OR sender = ?) ORDER BY message_id ASC LIMIT 200;
                    `, [friendshipId, userId, friendId], async (error, response) => {
                        if (error) reject(error);
                        else {
                            resolve(response);
                        }

                        conn.end();
                    });
                }
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

     giftItem(userId, itemId) {
        return new Promise(async (resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query('INSERT INTO inventory(item_id, user_id) VALUES (?, ?);', [itemId, userId], async (error) => {
                if (error) reject(error);
                else {
                    resolve(true);

                    await this.redis.set(`giftId:${userId}`, itemId);
                };
            });
        });
    }

    getGiftNotificationItem(userId) {
        return new Promise(async (resolve, reject) => {
            const itemId = await this.redis.get(`giftId:${userId}`);

            if (itemId == null) {
                resolve(null);
                return;
            }

            await this.redis.del(`giftId:${userId}`);

            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query('SELECT item_id, name, description, category, item_data FROM shop WHERE item_id = ?;', [itemId], async (error, response) => {
                if (error) reject(error);
                else {
                    resolve({ ...response[0], item_data: JSON.parse(response[0].item_data) });
                    return;
                };
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

    getDropRates() {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const query = `
            SELECT name, item_data FROM shop WHERE category = 'lootbox';
            `;
            conn.query(query, async (error, response) => {
                if (error) reject(error);
                else {
                    const items = response.map(item => {
                        const newItem = {
                            ...item,
                            drop_rates: JSON.parse(item.item_data).loot.sort((a, b) => a.chance - b.chance)
                        };
                        delete newItem.item_data;
                        return newItem;
                    });

                    // Iterate each box from the shop table
                    for (let i = 0; i < items.length; i++) {
                        // Ensure the drop rates of each item category are sorted in ascending order
                        items[i].drop_rates.sort((a, b) => a.chance - b.chance);

                        // Declare the drop chance of the previous item (but 0 for now)
                        let previousChance = 0;
                        items[i].drop_rates = items[i].drop_rates.map(item => {
                            // Calculate the chance based on the chance of the previous item and multiply by 100 to turn a fraction into percentage + floor the result to avoid repeating decimals
                            const chance = Math.floor((item.chance - previousChance) * 100);
                            // Set previousChance to the current chance for the next category
                            previousChance = item.chance;
                            return {
                                category: item.category,
                                chance
                            };
                        });
                    }

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
            SELECT s.item_data FROM inventory i JOIN shop s ON i.item_id = s.item_id WHERE i.user_id = ? AND i.inventory_item_id = ? AND s.category = 'lootbox';
            SELECT s.item_id, s.name, s.description, s.category, s.item_data FROM shop s LEFT JOIN inventory i ON s.item_id = i.item_id AND i.user_id = ? WHERE (i.item_id IS NULL OR s.limit_to_one = 0) AND s.lootbox_droppable = 1 ORDER BY UUID();
            `;
            conn.query(query, [userId, lootboxId, userId], async (error, response) => {
                if (error) reject(error);
                else if (response[0].length > 0) {
                    // let allowedLootCategories;
                    // try {
                    //     allowedLootCategories = JSON.parse(response[0][0].item_data).lootCategories;
                    //     if (allowedLootCategories.constructor !== Array) {
                    //         throw new Error(); // I don't need to include a message as this error is going to be handled anyway.
                    //     }
                    // } catch (err) {
                    //     resolve(false);
                    //     return;
                    // }

                    // response[1] = response[1].filter(item => allowedLootCategories.includes(item.category));

                    // We first shuffle all the possible items.
                    shuffle(response[1]);

                    // Then we get the box's possible loot categories (along with drop chances per category)
                    let loot;
                    try {
                        loot = JSON.parse(response[0][0].item_data).loot;
                        if (loot.constructor !== Array) {
                            throw new Error(); // We don't need to include a message as this error is going to be handled anyway.
                        }
                    } catch (err) {
                        resolve(false);
                        return;
                    }

                    const getDrop = () => {
                        // Sort the possible item categories by drop chance in an ascending order
                        loot.sort((a, b) => a.chance - b.chance);

                        const randomNumber = Math.random();

                        // Iterate item categories that are allowed to drop from the box. (We are iterating from the least possible drops, because we sorted that array earlier)
                        for (const itemType of loot) {
                            // Pick the first item of the type and get it's index.
                            // Even though it's the first item from the top, the response[1] array (containing possible items) has been shuffled previously.
                            let foundItem = response[1].findIndex(shopItem => shopItem.category === itemType.category);

                            // If randomNumber is smaller than item.chance - which is the drop chance of an item from the box - and a random item from this category has been found in unowned/repeatable items.
                            if (randomNumber < itemType.chance && foundItem !== -1) {
                                // Return the found item's index
                                return foundItem;
                            }
                        }

                        // If after iterating all the possible item categories, the function still hasn't returned for some reason, return an XP Boost.
                        return response[1].findIndex(item => item.category === 'xp_boost');
                    }

                    // Define a query: Delete the lootbox's record and insert the dropped item into the user's inventory instead.
                    query = `
                    DELETE FROM inventory WHERE inventory_item_id = ?;
                    INSERT INTO inventory(item_id, user_id) VALUES (?, ?);
                    `;

                    // Pick a random item.
                    const drop = getDrop();

                    // Execute the query.
                    conn.query(query, [lootboxId, response[1][drop].item_id, userId], async (error) => {
                        if (error) reject(error);
                        else {
                            conn.end();

                            // Parse the JSON data contained in a LONGTEXT as a JSON object and resolve the promise.
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
            SELECT (CASE WHEN a.xp_boost_until > CURRENT_TIMESTAMP() THEN a.xp_boost_until ELSE NULL END) AS xp_boost_until FROM accounts a WHERE user_id = ?;
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
                    `;

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
            conn.query('SELECT xp, level, (CASE WHEN xp_boost_until > NOW() THEN 1 ELSE 0 END) AS xp_boost_active FROM accounts WHERE user_id = ?;', [userId], (err, results) => {
                amount = Math.floor(amount);

                if (err) return reject(err);
                if (results.length === 0) return reject('Player not found');

                let { xp, level, xp_boost_active } = results[0];

                if (xp_boost_active) {
                    amount *= 2;
                }

                xp += amount;

                let nextLevelXP = getXPForLevel(level + 1);
                let mastsEarned = 0;

                while (xp >= nextLevelXP) {
                    level++;
                    xp -= nextLevelXP;
                    nextLevelXP = getXPForLevel(level + 1);

                    // Levelup rewards in masts (ingame currency) or Statboxes
                    if (level % 25 === 0)         mastsEarned += 5000;
                    else if (level % 10 === 0)    this.giftItem(userId, 11); // 11 is the ID of a Three-masted Statbox in the shop.
                    else if (level % 5 === 0)     mastsEarned += 1500;
                    else                          mastsEarned += 500;

                    if (level === 2) { // If player has leveled up to level 2, send them a welcome gift :D
                        this.giftItem(userId, 11);
                        // 11 is the ID of a Three-masted Statbox in the shop.
                    }
                }

                conn.query('UPDATE accounts SET xp = ?, level = ?, masts = masts + ? WHERE user_id = ?;', [xp, level, mastsEarned, userId], (err, results) => {
                    if (err) return reject(err);
                    resolve(amount);
                });
            });
        });
    }

    sendMessage(senderId, recipientId, messageContent) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query('SELECT friendship_id FROM friendships WHERE (user1 = ? OR user2 = ?) AND (user1 = ? OR user2 = ?);', [senderId, senderId, recipientId, recipientId], (err, [result]) => {
                if (err) return reject(err);
                conn.query('INSERT INTO messages(friendship_id, sender, content) VALUES (?, ?, ?);', [result.friendship_id, senderId, messageContent], (err) => {
                    if (err) return reject(err);
                    resolve();
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
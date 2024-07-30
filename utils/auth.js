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
                user: options.user ? options.user : "root",
                pass: options.pass,
            },
        });

        this.mailFrom = `"Statki" <${options.getMatchListuser}>`
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
            conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)}`, async (error, response) => {
                if (error) { reject(error); return; }

                if (response.length === 0 || response[0].nickname == null) {
                    if (response.length === 0) {
                        conn.query(`INSERT INTO accounts(email) VALUES (${conn.escape(email)});`, (error) => { if (error) reject(error) });
                    }

                    conn.query(`SELECT user_id FROM accounts WHERE email = ${conn.escape(email)}`, async (error, response) => {
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
            conn.query(`SELECT language FROM accounts WHERE user_id = ${conn.escape(userId)}`, (error, response) => {
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

    startVerification(email, ip, agent, langId) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            const lang = new Lang([langId]);

            conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)}`, async (error, response) => {
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

                    conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)}`, async (error, response) => {
                        if (error) reject(error);
                        const row = response[0];

                        const html = fs.readFileSync(path.join(__dirname, `mail/auth-code-firsttime-${langId}.html`), 'utf8');
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

    saveMatch(matchId, duration, type, hostId, guestId, boards, winnerIdx, aitype = null) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`INSERT INTO matches(match_id, match_type, host_id, guest_id, duration${aitype == null ? "" : ", ai_type"}) VALUES (${conn.escape(matchId)}, ${conn.escape(type)}, ${conn.escape(hostId)}, ${conn.escape(guestId)}, ${conn.escape(duration)}${aitype == null ? "" : ", " + conn.escape(aitype)})`, async (error) => {
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
            SELECT nickname, viewed_news, account_creation FROM accounts WHERE user_id = ?;
            SELECT ROUND((AVG(statistics.won)) * 100) AS winrate, COUNT(statistics.match_id) AS alltime_matches, COUNT(CASE WHEN (YEAR(matches.date) = YEAR(NOW()) AND MONTH(matches.date) = MONTH(NOW())) THEN matches.match_id END) AS monthly_matches FROM accounts NATURAL JOIN statistics NATURAL JOIN matches WHERE accounts.user_id = ?;
            SELECT statistics.match_id, accounts.nickname AS opponent, matches.match_type, statistics.won, matches.ai_type, matches.duration, matches.date FROM statistics JOIN matches ON matches.match_id = statistics.match_id JOIN accounts ON accounts.user_id = (CASE WHEN matches.host_id != statistics.user_id THEN matches.host_id ELSE matches.guest_id END) WHERE statistics.user_id = ? ORDER BY matches.date DESC LIMIT 10;
            `;
            conn.query(query, [userId, userId, userId], async (error, response) => {
                if (error) reject(error);
                else {
                    if (response[0].length === 0 || response[1].length === 0) {
                        reject(0);
                        return;
                    }

                    const [[profile], [stats], matchHistory] = response;

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
                matches.match_type, 
                statistics.won, 
                matches.ai_type, 
                matches.duration, 
                matches.date 
            FROM statistics 
            JOIN matches ON matches.match_id = statistics.match_id 
            JOIN accounts ON accounts.user_id = 
                (CASE 
                    WHEN matches.host_id != statistics.user_id THEN matches.host_id 
                    ELSE matches.guest_id 
                END) 
            WHERE statistics.user_id = ? 
            ORDER BY matches.date DESC 
            LIMIT ? OFFSET ?;
        `;

            conn.query(query, [userId, limit, offset], (error, response) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
                conn.end();
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

    setNickname(uid, nickname) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`UPDATE accounts SET nickname = ${conn.escape(nickname)} WHERE user_id = ${conn.escape(uid)}`, (error) => {
                if (error) reject(error);
                resolve();

                conn.end();
            });
        });
    }

    setViewedNews(uid) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`UPDATE accounts SET viewed_news = 1 WHERE user_id = ${conn.escape(uid)}`, (error) => {
                if (error) reject(error);
                resolve();

                conn.end();
            });
        });
    }

    getNickname(uid) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`SELECT nickname FROM accounts WHERE user_id = ${conn.escape(uid)}`, (error, response) => {
                if (error) reject(error);
                resolve(response[0].nickname);
            });

            conn.end();
        });
    }
}

function genCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}
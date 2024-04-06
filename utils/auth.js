import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import geoip from 'geoip-lite';

import mysql from 'mysql';
import readline from "node:readline";

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

        this.mailFrom = `"Statki" <${options.user}>`
    }

    async timer(tId, time, callback) {
        await this.redis.set(`loginTimer:${tId}`, new Date().getTime() / 1000);
        let localLastUpdate = await this.redis.get(`loginTimer:${tId}`);

        let timeout = setTimeout(callback, time * 1000);

        let interval = setInterval(async () => {
            if (timeout._destroyed) {
                clearInterval(interval);
                return;
            }

            let lastUpdate = await this.redis.get(`loginTimer:${tId}`);
            if (localLastUpdate != lastUpdate) {
                clearTimeout(timeout);
                clearInterval(interval);
                return;
            }
        }, 200);
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

    startVerification(email, ip, agent) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
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

                        const html = fs.readFileSync(path.join(__dirname, 'mail/auth-code-firsttime.html'), 'utf8');
                        let authCode = genCode();

                        await this.redis.set(`codeAuth:${authCode}`, row.user_id);

                        await this.timer(row.user_id, 600, async () => {
                            await this.redis.json.del(`codeAuth:${authCode}`);
                        });

                        authCode = authCode.slice(0, 4) + " " + authCode.slice(4);

                        const lookup = geoip.lookup(ip);

                        const lookupData = `User-Agent: ${agent}\nAdres IP: ${ip}\nKraj: ${lookup.country}\nRegion: ${lookup.region}\nMiasto: ${lookup.city}`;

                        try {
                            await this.mail.sendMail({
                                from: this.mailFrom,
                                to: email,
                                subject: `${authCode} to twój kod autoryzacji do Statków`,
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

                const html = fs.readFileSync(path.join(__dirname, 'mail/auth-code.html'), 'utf8');
                let authCode = genCode();

                await this.redis.set(`codeAuth:${authCode}`, row.user_id);

                await this.timer(row.user_id, 600, async () => {
                    await this.redis.json.del(`codeAuth:${authCode}`);
                });

                authCode = authCode.slice(0, 4) + " " + authCode.slice(4);

                const lookup = geoip.lookup(ip);

                const lookupData = `User-Agent: ${agent}\nAdres IP: ${ip}\nKraj: ${lookup.country}\nRegion: ${lookup.region}\nMiasto: ${lookup.city}`;

                try {
                    await this.mail.sendMail({
                        from: this.mailFrom,
                        to: email,
                        subject: `${authCode} to twój kod logowania do Statków`,
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

    saveMatch(matchId, duration, type, hostId, guestId, boards, winnerIdx) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`INSERT INTO matches(match_id, match_type, host_id, guest_id, duration) VALUES (${conn.escape(matchId)}, ${conn.escape(type)}, ${conn.escape(hostId)}, ${conn.escape(guestId)}, ${conn.escape(duration)})`, async (error) => {
                if (error) reject(error);
                else conn.query(`INSERT INTO statistics(match_id, user_id, board, won) VALUES (${conn.escape(matchId)}, ${conn.escape(hostId)}, ${conn.escape(JSON.stringify(boards[0]))}, ${conn.escape(winnerIdx ? 0 : 1)}), (${conn.escape(matchId)}, ${conn.escape(guestId)}, ${conn.escape(JSON.stringify(boards[1]))}, ${conn.escape(winnerIdx ? 1 : 0)})`, async (error, response) => {
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
            conn.query(`SELECT nickname, account_creation FROM accounts WHERE user_id = ${conn.escape(userId)}; SELECT ROUND((AVG(statistics.won)) * 100) AS winrate, COUNT(statistics.match_id) AS alltime_matches, COUNT(CASE WHEN (YEAR(matches.date) = YEAR(NOW()) AND MONTH(matches.date) = MONTH(NOW())) THEN matches.match_id END) AS monthly_matches FROM accounts NATURAL JOIN statistics NATURAL JOIN matches WHERE accounts.user_id = ${conn.escape(userId)}; SELECT statistics.match_id, accounts.nickname AS opponent, matches.match_type, statistics.won, matches.duration, matches.date FROM statistics JOIN matches ON matches.match_id = statistics.match_id JOIN accounts ON accounts.user_id = (CASE WHEN matches.host_id != statistics.user_id THEN matches.host_id ELSE matches.guest_id END) WHERE statistics.user_id = ${conn.escape(userId)} ORDER BY matches.date DESC LIMIT 10;`, async (error, response) => {
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

    async finishVerification(uid, authCode) {
        authCode = authCode.replace(/\s+/g, "");
        const rUid = await this.redis.get(`codeAuth:${authCode}`);
        if (rUid != null && rUid === uid) {
            this.resetTimer(rUid);
            await this.redis.del(`codeAuth:${authCode}`);
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
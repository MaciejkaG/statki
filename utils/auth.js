import nodemailer from 'nodemailer';
import uuid4 from 'uuid4';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mysql from 'mysql';
import { createClient } from 'redis';
import readline from "node:readline";
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const saltRounds = 10;

export class MailAuth {
    constructor(redis, options, mysqlOptions) {
        this.redis = redis;
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
        await this.redis.set(`timer:${tId}`, new Date().getTime() / 1000);
        let localLastUpdate = await this.redis.get(`timer:${tId}`);

        let timeout = setTimeout(callback, time * 1000);

        let interval = setInterval(async () => {
            if (timeout._destroyed) {
                clearInterval(interval);
                return;
            }

            let lastUpdate = await this.redis.get(`timer:${tId}`);
            if (localLastUpdate != lastUpdate) {
                clearTimeout(timeout);
                clearInterval(interval);
                return;
            }
        }, 200);
    }

    async resetTimer(tId) {
        let lastUpdate = await this.redis.get(`timer:${tId}`);
        await this.redis.set(`timer:${tId}`, -lastUpdate);
    }

    startVerification(email) {
        return new Promise((resolve, reject) => {
            const conn = mysql.createConnection(this.mysqlOptions);
            conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)}`, async (error, response) => {
                if (error) reject(error);
                if (response.length === 0 || response[0].nickname == null) {

                    conn.query(`DELETE FROM accounts WHERE email = ${conn.escape(email)};`, (error, response) => { if (error) reject(error) });
                    conn.query(`INSERT INTO accounts(email) VALUES (${conn.escape(email)});`, (error, response) => { if (error) reject(error) });
                    conn.query(`SELECT user_id, nickname FROM accounts WHERE email = ${conn.escape(email)}`, async (error, response) => {
                        if (error) reject(error);
                        const row = response[0];

                        const html = fs.readFileSync(path.join(__dirname, 'mail/auth-code-firsttime.html'), 'utf8');
                        let authCode = genCode();
                        let tId = uuid4();

                        await this.redis.json.set(`code_auth:${authCode}`, "$", { uid: row.user_id, tid: tId });

                        await this.timer(tId, 600, async () => {
                            await this.redis.json.del(`code_auth:${authCode}`);
                        });

                        authCode = authCode.slice(0, 4) + " " + authCode.slice(4);

                        try {
                            await this.mail.sendMail({
                                from: this.mailFrom,
                                to: email,
                                subject: `${authCode} to twój kod autoryzacji do Statków`,
                                html: html.replace("{{ CODE }}", authCode),
                            });
                        } catch (e) {
                            reject(e);
                        }

                        resolve({ status: 1, uid: row.user_id });
                    });

                    return;
                }

                const row = response[0];

                const html = fs.readFileSync(path.join(__dirname, 'mail/auth-code.html'), 'utf8');
                let authCode = genCode();
                let tId = uuid4();

                await this.redis.json.set(`code_auth:${authCode}`, "$", { uid: row.user_id, tid: tId });

                await this.timer(tId, 600, async () => {
                    await this.redis.json.del(`code_auth:${authCode}`);
                });

                authCode = authCode.slice(0, 4) + " " + authCode.slice(4);

                await this.mail.sendMail({
                    from: this.mailFrom,
                    to: email,
                    subject: `${authCode} to twój kod logowania do Statków`,
                    html: html.replace("{{ NICKNAME }}", row.nickname).replace("{{ CODE }}", authCode),
                });

                resolve({ status: 1, uid: row.user_id });
            });
        });
    }

    async finishVerification(uid, authCode) {
        authCode = authCode.replace(/\s+/g, "");
        let redisRes = await this.redis.json.get(`code_auth:${authCode}`);
        if (redisRes != null && redisRes.uid === uid) {
            this.resetTimer(redisRes.tid);
            await this.redis.del(`code_auth:${authCode}`);
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
        });
    }
}

function genCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}
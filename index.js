"use strict";
const puppeteer = require("puppeteer");
const PDFMerger = require("pdf-merger-js");
const fs = require("fs-extra");
const { outputPath, overwrite } = require("./config.json");
let page = null;
let stylesheet = null;

async function ensureGoTo(page, url) {
    let response = await page.goto(url, { "waitUntil": "networkidle2" });
    while (response.status() !== 200) {
        response = page.reload();
    }
    return page;
}

async function convertToPDF(url, name, i) {
    let path = `${outputPath}/${name}/`;
    let filename = `${i}.pdf`;

    if (!overwrite && await fs.pathExists(path + filename)) {
        return path + filename;
    }

    await fs.ensureDir(path);
    page = await ensureGoTo(page, url);
    await page.addStyleTag({ "content": stylesheet });

    let height = await page.evaluate(() => {
        let article = document.querySelector("#content article") || document.querySelector("#content") || document.body;
        return article.scrollHeight;
    });
    path += filename;
    await page.pdf({ path, height, "printBackground": true });
    return path;
}

(async() => {
    stylesheet = await fs.readFile("stylesheet.css", "utf8");
    const cookies = await fs.readJSON("cookies.json");
    const browser = await puppeteer.launch();

    page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(90000);
    await page.setCookie(...cookies);
    await page.emulateMedia("screen");

    page = await ensureGoTo(page, "https://primagames.com/accounts/account/my_guides");
    let guides = await page.evaluate(() => [...document.querySelectorAll("a.cover")].map(e => ({
        "url":   e.href,
        "title": e.nextSiblings(".title")[0].innerText.replace(/[^A-Za-z0-9 ]+/g, "")
    })));

    for (let guide of guides) {
        let merger = new PDFMerger();
        let { url, title } = guide;
        page = await ensureGoTo(page, url);

        let pages = await page.evaluate(() => [...document.querySelectorAll("#chapters a[data-section-id]")].map(e => e.href));
        for (let i = 1; i <= pages.length; i++) {
            let page = pages[i - 1];
            let path = await convertToPDF(page, title, i);
            console.log(path);
            merger.add(path);
        }

        let savePath = `${outputPath}/${title}.pdf`;
        if (!overwrite && await fs.pathExists(savePath)) {
            console.log(savePath);
            continue;
        }

        await merger.save(savePath);
        console.log(savePath);
    }

    await browser.close();
    process.exit(0);
})().catch(err => {
    console.log(err);
    process.exit(1);
});
